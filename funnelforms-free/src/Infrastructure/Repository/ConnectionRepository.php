<?php
/**
 * Integration connections with their encrypted secrets.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Infrastructure\Repository;

use Funnelforms\Infrastructure\Crypto\SecretBox;
use Funnelforms\Infrastructure\Database\Schema;

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- custom table of this plugin; secrets are not cached on purpose.

/**
 * Secrets are decrypted only for the request that sends with them and never logged.
 */
final class ConnectionRepository {

	/**
	 * Creates the repository.
	 *
	 * @param SecretBox $box Encryption.
	 */
	public function __construct( private SecretBox $box ) {}

	/**
	 * A connection by ref.
	 *
	 * @param string $ref Connection ref, e.g. legacy:smtp:….
	 * @return array{type:string,config:array<string,mixed>,secret:array<string,mixed>}|null
	 */
	public function by_ref( string $ref ): ?array {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT type, config, secret FROM %i WHERE ref = %s', Schema::table( 'connections' ), $ref ), ARRAY_A );
		if ( ! is_array( $row ) ) {
			return null;
		}
		$secret = is_string( $row['secret'] ) ? $this->box->decrypt( $row['secret'] ) : null;
		$config = json_decode( (string) $row['config'], true );
		$secret = null === $secret ? null : json_decode( $secret, true );
		return array(
			'type'   => (string) $row['type'],
			'config' => is_array( $config ) ? $config : array(),
			'secret' => is_array( $secret ) ? $secret : array(),
		);
	}

	/**
	 * Connections of some types, without their secrets, oldest first.
	 *
	 * @param string[] $types Types.
	 * @return array<int,array{ref:string,type:string,label:string,created_at:string}>
	 */
	public function of_types( array $types ): array {
		global $wpdb;
		if ( array() === $types ) {
			return array();
		}
		$in   = implode( ', ', array_fill( 0, count( $types ), '%s' ) );
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT ref, type, label, created_at FROM %i WHERE type IN ({$in}) ORDER BY id ASC", Schema::table( 'connections' ), ...$types ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- one placeholder per type.
		return is_array( $rows ) ? $rows : array();
	}

	/**
	 * Stores a connection (credentials encrypted), keyed on its ref.
	 *
	 * @param array{ref:string,type:string,label:string,config:array<string,mixed>,secret:array<string,mixed>} $connection Connection.
	 * @return int Row ID.
	 */
	public function save( array $connection ): int {
		global $wpdb;
		$table  = Schema::table( 'connections' );
		$now    = gmdate( 'Y-m-d H:i:s' );
		$values = array(
			'type'       => $connection['type'],
			'label'      => $connection['label'],
			'config'     => (string) wp_json_encode( $connection['config'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ),
			'secret'     => $this->box->encrypt( (string) wp_json_encode( $connection['secret'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) ),
			'updated_at' => $now,
		);
		$id     = $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM %i WHERE ref = %s', $table, $connection['ref'] ) );
		if ( null !== $id ) {
			$wpdb->update( $table, $values, array( 'id' => (int) $id ) );
			return (int) $id;
		}
		$wpdb->insert(
			$table,
			$values + array(
				'ref'        => $connection['ref'],
				'created_at' => $now,
			)
		);
		return (int) $wpdb->insert_id;
	}

	/**
	 * Replaces the settings (not the credentials) of a connection, and its label.
	 *
	 * @param string              $ref    Connection ref.
	 * @param array<string,mixed> $config Settings.
	 * @param string              $label  Label.
	 */
	public function update_config( string $ref, array $config, string $label ): void {
		global $wpdb;
		$wpdb->update(
			Schema::table( 'connections' ),
			array(
				'config'     => (string) wp_json_encode( $config, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ),
				'label'      => $label,
				'updated_at' => gmdate( 'Y-m-d H:i:s' ),
			),
			array( 'ref' => $ref )
		);
	}

	/**
	 * Replaces the credentials of a connection, e.g. a renewed access token.
	 *
	 * @param string              $ref    Connection ref.
	 * @param array<string,mixed> $secret Credentials.
	 */
	public function replace_secret( string $ref, array $secret ): void {
		global $wpdb;
		$wpdb->update(
			Schema::table( 'connections' ),
			array(
				'secret'     => $this->box->encrypt( (string) wp_json_encode( $secret, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) ),
				'updated_at' => gmdate( 'Y-m-d H:i:s' ),
			),
			array( 'ref' => $ref )
		);
	}

	/**
	 * Deletes a connection.
	 *
	 * @param string $ref Connection ref.
	 */
	public function delete( string $ref ): void {
		global $wpdb;
		$wpdb->delete( Schema::table( 'connections' ), array( 'ref' => $ref ) );
	}
}
