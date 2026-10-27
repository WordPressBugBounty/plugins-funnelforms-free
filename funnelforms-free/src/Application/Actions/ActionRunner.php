<?php
/**
 * Delivers one queued action of an entry.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application\Actions;

use Funnelforms\Domain\Entry\EntryData;
use Funnelforms\Domain\Form\Document;
use Funnelforms\Edition\Edition;
use Funnelforms\Infrastructure\Crypto\SecretBox;
use Funnelforms\Infrastructure\Repository\ConnectionRepository;
use Funnelforms\Infrastructure\Repository\EntryRepository;
use Funnelforms\Infrastructure\Repository\FileRepository;
use Funnelforms\Infrastructure\Repository\FormRepository;
use Funnelforms\Integrations\HttpClient;
use Funnelforms\Integrations\WpHttpClient;

defined( 'ABSPATH' ) || exit;

/**
 * Runs a job from ffx_jobs_log. A failed delivery is retried twice with growing pauses; error texts
 * in the log name the cause only (HTTP status, error code), never visitor data. The mails are
 * delivered here; the actions of Funnelforms Pro (webhooks, CRM, messages, conversions, double
 * opt-in, appointments) by ProActions, which Funnelforms Free does not have.
 */
final class ActionRunner {

	public const MAX_ATTEMPTS = 3;

	/**
	 * Creates the runner.
	 *
	 * @param EntryRepository      $entries     Entries.
	 * @param FormRepository       $forms       Forms.
	 * @param Mailer               $mailer      Mail delivery.
	 * @param ConnectionRepository $connections Integration credentials.
	 * @param HttpClient           $http        HTTP for integrations.
	 */
	public function __construct(
		private EntryRepository $entries,
		private FormRepository $forms,
		private Mailer $mailer,
		private ConnectionRepository $connections,
		private HttpClient $http
	) {}

	/**
	 * Runner with the site services.
	 */
	public static function create(): self {
		$connections = new ConnectionRepository( SecretBox::for_site() );
		return new self( new EntryRepository(), new FormRepository(), new Mailer( $connections, new FileRepository() ), $connections, new WpHttpClient() );
	}

	/**
	 * Runs a job.
	 *
	 * @param int $job_id Job ID.
	 */
	public function run( int $job_id ): void {
		$job = $this->entries->job( $job_id );
		if ( null === $job || in_array( $job['status'], array( 'sent', 'skipped', 'failed' ), true ) ) {
			return;
		}
		$attempts = (int) $job['attempts'] + 1;
		$entry    = $this->entries->find( (int) $job['entry_id'] );
		$revision = (int) ( $entry['meta']['v5']['revisionId'] ?? 0 );
		$document = null === $entry ? null : $this->forms->document( $revision );
		$action   = null === $document ? null : ( new Document( $document ) )->action( (string) $job['channel'] );
		$pro      = Edition::pro( ProActions::class );
		if ( null !== $document && null !== $pro ) {
			// Jobs of double opt-in, appointments and reminders are not actions of the document.
			$action = $pro::job_action( (string) $job['channel'] ) ?? $action;
		}
		if ( null === $action ) {
			$this->entries->update_job( $job_id, 'skipped', $attempts, 'action_not_found' );
			return;
		}

		if ( ! in_array( $action['kind'], array( 'optin', 'booking', 'abandon' ), true ) && ! Edition::has_action( (string) $action['kind'] ) ) {
			$this->entries->update_job( $job_id, 'skipped', $attempts, 'pro_action:' . $action['kind'] );
			return;
		}

		$submission = EntryData::submission( $entry, new Document( $document ) );
		if ( isset( $action['when'] ) && is_array( $action['when'] ) && ! $submission->meets( $action['when'] ) ) {
			// Routing: the action is meant for other entries (another region, a lower score).
			$this->entries->update_job( $job_id, 'skipped', $attempts, 'condition_not_met' );
			return;
		}
		if ( in_array( $action['kind'], array( 'email', 'autoresponder' ), true ) ) {
			$error = $this->mailer->send( $action['config'], $submission, 'email' === $action['kind'] );
		} elseif ( null !== $pro && $pro::handles( (string) $action['kind'] ) ) {
			$error = ( new $pro( $this->forms, $this->mailer, $this->connections, $this->http ) )->run( $action, $job, $submission, $entry );
		} else {
			$this->entries->update_job( $job_id, 'skipped', $attempts, 'unsupported_action:' . $action['kind'] );
			return;
		}

		// Nobody to send to, no consent, no GA4 client or an appointment changed since: nothing to
		// do, not a failure.
		if ( null === $error || in_array( $error, array_merge( array( 'no_recipient' ), null === $pro ? array() : $pro::NOTHING_TO_DO ), true ) ) {
			$this->entries->update_job( $job_id, null === $error ? 'sent' : 'skipped', $attempts, $error );
			return;
		}
		if ( $attempts < self::MAX_ATTEMPTS && ! str_starts_with( $error, 'permanent:' ) ) {
			$this->entries->update_job( $job_id, 'retrying', $attempts, $error );
			ActionQueue::schedule( $job_id, 60 * ( 4 ** ( $attempts - 1 ) ) );
			return;
		}
		$this->entries->update_job( $job_id, 'failed', $attempts, $error );
	}
}
