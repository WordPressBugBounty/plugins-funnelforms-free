<?php
/**
 * Entry point of the Funnelforms Pro 5.0 core.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms;

defined( 'ABSPATH' ) || exit;

use Funnelforms\Admin\AccountPage;
use Funnelforms\Admin\StatsPage;
use Funnelforms\Admin\AppPage;
use Funnelforms\Admin\ReferPage;
use Funnelforms\Admin\SupportPage;
use Funnelforms\Admin\BuilderPage;
use Funnelforms\Admin\EntriesPage;
use Funnelforms\Admin\EntriesExport;
use Funnelforms\Admin\ImportPage;
use Funnelforms\Admin\EntryPdfDownload;
use Funnelforms\Admin\Menu;
use Funnelforms\Admin\AppointmentsPage;
use Funnelforms\Admin\CronofyNotice;
use Funnelforms\Admin\PredictionPage;
use Funnelforms\Admin\IntegrationsPage;
use Funnelforms\Admin\MigrationPage;
use Funnelforms\Admin\SettingsPage;
use Funnelforms\Admin\SetupPage;
use Funnelforms\Admin\Ui;
use Funnelforms\Admin\Privacy;
use Funnelforms\Admin\PrivacyPolicyText;
use Funnelforms\Admin\SiteHealth;
use Funnelforms\Application\Actions\ActionQueue;
use Funnelforms\Application\Capabilities;
use Funnelforms\Application\FileCleanup;
use Funnelforms\Application\Retention;
use Funnelforms\Application\SupportAccess;
use Funnelforms\Application\Telemetry\AdminUsage;
use Funnelforms\Application\Telemetry\Sender;
use Funnelforms\Application\License\License;
use Funnelforms\Application\SaveProgress;
use Funnelforms\Cli\BackupCommand;
use Funnelforms\Cli\FormCommand;
use Funnelforms\Cli\MigrateCommand;
use Funnelforms\Cli\OpenApiCommand;
use Funnelforms\Compat\Import\ImportCommand;
use Funnelforms\Compat\Import\ImportController;
use Funnelforms\Compat\Legacy\LegacyLicense;
use Funnelforms\Compat\Migration\MigrationRunner;
use Funnelforms\Compat\Safety\LegacyBackup;
use Funnelforms\Compat\Safety\LegacyRestore;
use Funnelforms\Edition\Edition;
use Funnelforms\Frontend\Elementor;
use Funnelforms\Frontend\ExternalEmbed;
use Funnelforms\Frontend\FormBlock;
use Funnelforms\Frontend\EntriesShortcode;
use Funnelforms\Frontend\BookingPage;
use Funnelforms\Frontend\FunnelPage;
use Funnelforms\Frontend\LegacyPreview;
use Funnelforms\Frontend\OptInPage;
use Funnelforms\Frontend\PaymentReturn;
use Funnelforms\Frontend\Shortcode;
use Funnelforms\Frontend\UiLocale;
use Funnelforms\Http\AppController;
use Funnelforms\Http\AppointmentsController;
use Funnelforms\Http\AutomationController;
use Funnelforms\Http\CalendarOAuthController;
use Funnelforms\Http\McpServer;
use Funnelforms\Http\ConnectionsController;
use Funnelforms\Http\EntriesController;
use Funnelforms\Http\FileDownload;
use Funnelforms\Http\FormsAdminController;
use Funnelforms\Http\FormsController;
use Funnelforms\Http\PaymentsController;
use Funnelforms\Http\PreviewController;
use Funnelforms\Http\RolesController;
use Funnelforms\Http\StatsController;
use Funnelforms\Infrastructure\Database\Schema;
use Funnelforms\Integrations\Crm\CrmController;

/**
 * Wires the 5.0 services into WordPress.
 *
 * Updates from 3.x replace the files without running the activation hook, so the tables are
 * created on the first request after the update (Schema::maybe_upgrade()), not only on activation.
 */
final class Plugin {

	/** Action fired on deactivation, for what a module has to end while the plugin stops. */
	public const DEACTIVATE = 'funnelforms_deactivate';

	/**
	 * Main plugin file.
	 *
	 * @var string
	 */
	private static string $file = '';

	/**
	 * Registers hooks. Called once from src/bootstrap.php.
	 *
	 * @param string $file Main plugin file.
	 */
	public static function boot( string $file ): void {
		if ( '' !== self::$file ) {
			return;
		}
		self::$file = $file;

		register_activation_hook( $file, array( Schema::class, 'install' ) );
		register_activation_hook( $file, array( Retention::class, 'seed' ) );
		register_deactivation_hook( $file, array( self::class, 'deactivate' ) );
		add_action( 'plugins_loaded', array( Schema::class, 'maybe_upgrade' ), 5 );
		add_action( 'init', array( UiLocale::class, 'load_textdomain' ), 0 );

		foreach ( self::modules() as $module ) {
			if ( Edition::has_module( $module ) ) {
				$module::register();
			}
		}

		if ( is_admin() ) {
			foreach ( self::admin_modules() as $module ) {
				if ( Edition::has_module( $module ) ) {
					$module::register();
				}
			}
		}

		if ( defined( 'WP_CLI' ) && WP_CLI ) {
			\WP_CLI::add_command( 'funnelforms migration', MigrateCommand::class );
			\WP_CLI::add_command( 'funnelforms form', FormCommand::class );
			\WP_CLI::add_command( 'funnelforms backup', BackupCommand::class );
			if ( Edition::is_pro() ) {
				\WP_CLI::add_command( 'funnelforms openapi', OpenApiCommand::class );
			}
			\WP_CLI::add_command( 'funnelforms import', ImportCommand::class );
		}
	}

	/**
	 * Modules for every request, in the order they register. Funnelforms Free leaves out the
	 * ones Edition::PRO_MODULES names.
	 *
	 * @return array<int,class-string>
	 */
	private static function modules(): array {
		return array(
			LegacyLicense::class,
			Capabilities::class,
			MigrationRunner::class,
			LegacyBackup::class,
			LegacyRestore::class,
			ActionQueue::class,
			FormsController::class,
			EntriesController::class,
			AppController::class,
			\Funnelforms\Application\AppPush::class,
			AppointmentsController::class,
			StatsController::class,
			\Funnelforms\Http\FiguresController::class,
			AutomationController::class,
			McpServer::class,
			ConnectionsController::class,
			\Funnelforms\Http\IntegrationsController::class,
			CrmController::class,
			ImportController::class,
			CalendarOAuthController::class,
			\Funnelforms\Http\CalendarsController::class,
			PaymentsController::class,
			\Funnelforms\Application\Payments::class,
			FormsAdminController::class,
			PreviewController::class,
			RolesController::class,
			EntriesExport::class,
			EntryPdfDownload::class,
			FileDownload::class,
			FileCleanup::class,
			SaveProgress::class,
			\Funnelforms\Application\Abandonment::class,
			Retention::class,
			\Funnelforms\Application\ExperimentSchedule::class,
			SupportAccess::class,
			License::class,
			\Funnelforms\Application\License\LicenseLock::class,
			\Funnelforms\Application\Notices\Notices::class,
			Sender::class,
			AdminUsage::class,
			Privacy::class,
			PrivacyPolicyText::class,
			Shortcode::class,
			EntriesShortcode::class,
			\Funnelforms\Compat\Multilingual::class,
			FormBlock::class,
			ExternalEmbed::class,
			OptInPage::class,
			\Funnelforms\Frontend\AbandonPage::class,
			FunnelPage::class,
			BookingPage::class,
			LegacyPreview::class,
			PaymentReturn::class,
			Elementor::class,
		);
	}

	/**
	 * Modules of the admin pages.
	 *
	 * @return array<int,class-string>
	 */
	private static function admin_modules(): array {
		return array(
			Ui::class,
			Menu::class,
			MigrationPage::class,
			SettingsPage::class,
			BuilderPage::class,
			EntriesPage::class,
			AppointmentsPage::class,
			CronofyNotice::class,
			IntegrationsPage::class,
			StatsPage::class,
			PredictionPage::class,
			ImportPage::class,
			SiteHealth::class,
			AccountPage::class,
			AppPage::class,
			ReferPage::class,
			SupportPage::class,
			\Funnelforms\Admin\NoticesView::class,
			SetupPage::class,
		);
	}

	/**
	 * Removes the recurring jobs; they are scheduled again on the first request after the plugin
	 * is activated again. Single jobs (import, restore point, actions) stay so a running job goes
	 * on where it stopped. Modules that hold more (support access) end it on DEACTIVATE.
	 */
	public static function deactivate(): void {
		$hooks   = array_merge( array( MigrationRunner::HOOK_DELTA, Retention::HOOK, Sender::HOOK ), Schema::RETIRED_HOOKS );
		$modules = array(
			FileCleanup::class                       => 'HOOK',
			SupportAccess::class                     => 'HOOK',
			License::class                           => 'HOOK',
			\Funnelforms\Application\Notices\Notices::class => 'HOOK',
			\Funnelforms\Application\Payments::class => 'RECONCILE_HOOK',
			\Funnelforms\Application\ExperimentSchedule::class => 'HOOK',
		);
		foreach ( $modules as $module => $constant ) {
			if ( Edition::has_module( $module ) ) {
				$hooks[] = (string) constant( $module . '::' . $constant );
			}
		}
		foreach ( $hooks as $hook ) {
			wp_clear_scheduled_hook( $hook );
		}
		if ( function_exists( 'as_unschedule_all_actions' ) ) {
			as_unschedule_all_actions( MigrationRunner::HOOK_DELTA, array(), 'funnelforms' );
		}

		/**
		 * Fires when the plugin is deactivated, after its recurring jobs were removed.
		 */
		do_action( 'funnelforms_deactivate' );
	}

	/**
	 * Main plugin file.
	 */
	public static function file(): string {
		return self::$file;
	}
}
