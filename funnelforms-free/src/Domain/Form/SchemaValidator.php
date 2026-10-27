<?php
/**
 * Checks form documents against the JSON schema of packages/form-schema.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Domain\Form;

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- JSON Schema keywords.

/**
 * The part of JSON Schema (draft-07) that form.v1.schema.json uses: type, $ref to definitions,
 * properties, required, additionalProperties, items, oneOf, const, enum, pattern, minLength,
 * maxLength, minimum, maximum, exclusiveMinimum, minItems, maxItems and uniqueItems. The plugin
 * ships a copy of the schema (assets/schema); a unit test keeps it equal to the package and
 * checks the results against a full validator. Documents come decoded as objects (stdClass), so
 * that {} and [] stay apart.
 */
final class SchemaValidator {

	/** Most errors reported. */
	private const MAX_ERRORS = 20;

	/**
	 * The schema.
	 *
	 * @var object
	 */
	private object $schema;

	/**
	 * Errors of the current run: "/path: message".
	 *
	 * @var string[]
	 */
	private array $errors = array();

	/**
	 * Creates the validator.
	 *
	 * @param object|null $schema Decoded schema; the shipped copy when null.
	 */
	public function __construct( ?object $schema = null ) {
		$this->schema = $schema ?? self::shipped();
	}

	/**
	 * The schema shipped with the plugin.
	 */
	public static function shipped(): object {
		static $schema = null;
		if ( null === $schema ) {
			$schema = json_decode( (string) file_get_contents( dirname( __DIR__, 3 ) . '/assets/schema/form.v1.schema.json' ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- a file of the plugin.
		}
		return $schema;
	}

	/**
	 * Problems of a document, empty when it fits the schema.
	 *
	 * @param mixed $document Document decoded with objects (json_decode without assoc).
	 * @return string[]
	 */
	public function validate( $document ): array {
		$this->errors = array();
		$this->check( $document, $this->schema, '' );
		return $this->errors;
	}

	/**
	 * A copy of a document where empty arrays stand for the empty objects the schema wants.
	 * Documents that went through json_decode( …, true ) lost the difference ({} became []).
	 *
	 * @param mixed $document Document decoded with objects.
	 * @return mixed
	 */
	public function repair( $document ) {
		$fixed        = $this->fix( $document, $this->schema );
		$this->errors = array();
		return $fixed;
	}

	/**
	 * Repairs a value for a schema.
	 *
	 * @param mixed  $value  Value.
	 * @param object $schema Schema.
	 * @return mixed
	 */
	private function fix( $value, object $schema ) {
		if ( isset( $schema->{'$ref'} ) ) {
			$value = $this->fix( $value, $this->resolve( (string) $schema->{'$ref'} ) );
		}
		if ( isset( $schema->oneOf ) ) {
			$value = $this->fix_one_of( $value, (array) $schema->oneOf );
		}
		if ( array() === $value && isset( $schema->type ) && self::has_type( new \stdClass(), $schema->type ) && ! self::has_type( array(), $schema->type ) ) {
			return new \stdClass();
		}
		if ( is_object( $value ) ) {
			$value      = clone $value;
			$properties = isset( $schema->properties ) ? (array) $schema->properties : array();
			foreach ( get_object_vars( $value ) as $name => $item ) {
				if ( isset( $properties[ $name ] ) ) {
					$value->{$name} = $this->fix( $item, $properties[ $name ] );
				} elseif ( isset( $schema->additionalProperties ) && is_object( $schema->additionalProperties ) ) {
					$value->{$name} = $this->fix( $item, $schema->additionalProperties );
				}
			}
		} elseif ( is_array( $value ) && isset( $schema->items ) && is_object( $schema->items ) ) {
			foreach ( $value as $index => $item ) {
				$value[ $index ] = $this->fix( $item, $schema->items );
			}
		}
		return $value;
	}

	/**
	 * Repairs a value for the alternative it fits best.
	 *
	 * @param mixed    $value   Value.
	 * @param object[] $schemas Alternatives.
	 * @return mixed
	 */
	private function fix_one_of( $value, array $schemas ) {
		$best   = $value;
		$fewest = PHP_INT_MAX;
		foreach ( $schemas as $candidate ) {
			$target = isset( $candidate->{'$ref'} ) ? $this->resolve( (string) $candidate->{'$ref'} ) : $candidate;
			// Alternatives told apart by their type need not be tried for other types.
			if ( is_object( $value ) && isset( $value->type, $target->properties->type ) && property_exists( $target->properties->type, 'const' ) && $value->type !== $target->properties->type->const ) {
				continue;
			}
			// Nor alternatives whose own keys are missing (see one_of()).
			if ( is_object( $value ) && array() !== array_filter( (array) ( $target->required ?? array() ), static fn( $name ): bool => ! property_exists( $value, (string) $name ) ) ) {
				continue;
			}
			$fixed        = $this->fix( $value, $candidate );
			$this->errors = array();
			$this->check( $fixed, $candidate, '' );
			$count = count( $this->errors );
			if ( 0 === $count ) {
				return $fixed;
			}
			if ( $count < $fewest ) {
				$fewest = $count;
				$best   = $fixed;
			}
		}
		return $best;
	}

	/**
	 * Checks a value against a schema and records problems.
	 *
	 * @param mixed  $value  Value.
	 * @param object $schema Schema.
	 * @param string $path   JSON pointer of the value.
	 */
	private function check( $value, object $schema, string $path ): void {
		if ( count( $this->errors ) >= self::MAX_ERRORS ) {
			return;
		}
		if ( isset( $schema->{'$ref'} ) ) {
			$this->check( $value, $this->resolve( (string) $schema->{'$ref'} ), $path );
		}
		if ( isset( $schema->oneOf ) ) {
			$this->one_of( $value, (array) $schema->oneOf, $path );
		}
		if ( isset( $schema->type ) && ! self::has_type( $value, $schema->type ) ) {
			$this->error( $path, 'must be ' . implode( ' or ', (array) $schema->type ) );
			return;
		}
		if ( property_exists( $schema, 'const' ) && ! self::same( $value, $schema->const ) ) {
			$this->error( $path, 'must be ' . self::json( $schema->const ) );
		}
		if ( isset( $schema->enum ) && ! self::in( $value, (array) $schema->enum ) ) {
			$this->error( $path, 'must be one of ' . self::json( $schema->enum ) );
		}
		if ( is_string( $value ) ) {
			$this->string( $value, $schema, $path );
		} elseif ( is_int( $value ) || is_float( $value ) ) {
			$this->number( $value, $schema, $path );
		} elseif ( is_array( $value ) ) {
			$this->items( $value, $schema, $path );
		} elseif ( is_object( $value ) ) {
			$this->object( $value, $schema, $path );
		}
	}

	/**
	 * Exactly one of the schemas must match.
	 *
	 * @param mixed    $value   Value.
	 * @param object[] $schemas Schemas.
	 * @param string   $path    Path.
	 */
	private function one_of( $value, array $schemas, string $path ): void {
		$outer   = $this->errors;
		$matches = 0;
		$closest = null;
		$guessed = true;
		foreach ( $schemas as $candidate ) {
			$this->errors = array();
			// An alternative whose own keys are missing cannot match. Not looking inside keeps nested
			// alternatives (calculations in calculations) from being tried once per sibling.
			$missing = is_object( $value ) ? array_filter( (array) ( $candidate->required ?? array() ), static fn( $name ): bool => ! property_exists( $value, (string) $name ) ) : array();
			if ( array() !== $missing ) {
				foreach ( $missing as $name ) {
					$this->error( $path, 'needs ' . $name );
				}
			} else {
				$this->check( $value, $candidate, $path );
			}
			if ( array() === $this->errors ) {
				++$matches;
			} elseif ( null === $closest || ( $guessed && array() === $missing ) || ( ( $guessed || array() === $missing ) && count( $this->errors ) < count( $closest ) ) ) {
				// An alternative that has its keys says more than one that lacks them.
				$closest = $this->errors;
				$guessed = array() !== $missing;
			}
		}
		$this->errors = $outer;
		if ( 1 === $matches ) {
			return;
		}
		if ( 0 === $matches && null !== $closest ) {
			// The errors of the closest alternative say most about what is wrong.
			foreach ( $closest as $error ) {
				$this->errors[] = $error;
			}
			return;
		}
		$this->error( $path, 'matches more than one alternative' );
	}

	/**
	 * Keywords of strings.
	 *
	 * @param string $value  Value.
	 * @param object $schema Schema.
	 * @param string $path   Path.
	 */
	private function string( string $value, object $schema, string $path ): void {
		$length = mb_strlen( $value );
		if ( isset( $schema->minLength ) && $length < $schema->minLength ) {
			$this->error( $path, 'must have at least ' . $schema->minLength . ' characters' );
		}
		if ( isset( $schema->maxLength ) && $length > $schema->maxLength ) {
			$this->error( $path, 'must have at most ' . $schema->maxLength . ' characters' );
		}
		if ( isset( $schema->pattern ) && 1 !== preg_match( '/' . str_replace( '/', '\/', (string) $schema->pattern ) . '/u', $value ) ) {
			$this->error( $path, 'must match ' . $schema->pattern );
		}
	}

	/**
	 * Keywords of numbers.
	 *
	 * @param int|float $value  Value.
	 * @param object    $schema Schema.
	 * @param string    $path   Path.
	 */
	private function number( $value, object $schema, string $path ): void {
		if ( isset( $schema->minimum ) && $value < $schema->minimum ) {
			$this->error( $path, 'must be at least ' . $schema->minimum );
		}
		if ( isset( $schema->maximum ) && $value > $schema->maximum ) {
			$this->error( $path, 'must be at most ' . $schema->maximum );
		}
		if ( isset( $schema->exclusiveMinimum ) && $value <= $schema->exclusiveMinimum ) {
			$this->error( $path, 'must be more than ' . $schema->exclusiveMinimum );
		}
	}

	/**
	 * Keywords of arrays.
	 *
	 * @param array<int,mixed> $value  Value.
	 * @param object           $schema Schema.
	 * @param string           $path   Path.
	 */
	private function items( array $value, object $schema, string $path ): void {
		$count = count( $value );
		if ( isset( $schema->minItems ) && $count < $schema->minItems ) {
			$this->error( $path, 'must have at least ' . $schema->minItems . ' items' );
		}
		if ( isset( $schema->maxItems ) && $count > $schema->maxItems ) {
			$this->error( $path, 'must have at most ' . $schema->maxItems . ' items' );
		}
		if ( ! empty( $schema->uniqueItems ) ) {
			$seen = array();
			foreach ( $value as $item ) {
				$key = self::json( $item );
				if ( isset( $seen[ $key ] ) ) {
					$this->error( $path, 'must not repeat items' );
					break;
				}
				$seen[ $key ] = true;
			}
		}
		if ( isset( $schema->items ) && is_object( $schema->items ) ) {
			foreach ( array_values( $value ) as $index => $item ) {
				$this->check( $item, $schema->items, $path . '/' . $index );
			}
		}
	}

	/**
	 * Keywords of objects.
	 *
	 * @param object $value  Value.
	 * @param object $schema Schema.
	 * @param string $path   Path.
	 */
	private function object( object $value, object $schema, string $path ): void {
		foreach ( (array) ( $schema->required ?? array() ) as $name ) {
			if ( ! property_exists( $value, (string) $name ) ) {
				$this->error( $path, 'needs ' . $name );
			}
		}
		$properties = isset( $schema->properties ) ? (array) $schema->properties : array();
		foreach ( get_object_vars( $value ) as $name => $item ) {
			$name = (string) $name;
			if ( isset( $properties[ $name ] ) ) {
				$this->check( $item, $properties[ $name ], $path . '/' . self::escape( $name ) );
			} elseif ( isset( $schema->additionalProperties ) && false === $schema->additionalProperties ) {
				$this->error( $path, 'must not have ' . $name );
			} elseif ( isset( $schema->additionalProperties ) && is_object( $schema->additionalProperties ) ) {
				$this->check( $item, $schema->additionalProperties, $path . '/' . self::escape( $name ) );
			}
		}
	}

	/**
	 * A definition by its reference (#/definitions/<name>).
	 *
	 * @param string $ref Reference.
	 * @throws \InvalidArgumentException For references outside the definitions.
	 */
	private function resolve( string $ref ): object {
		if ( 1 !== preg_match( '#^\#/definitions/([A-Za-z0-9_]+)$#', $ref, $m ) || ! isset( $this->schema->definitions->{$m[1]} ) ) {
			throw new \InvalidArgumentException( 'Unknown reference in the form schema' );
		}
		return $this->schema->definitions->{$m[1]};
	}

	/**
	 * Whether a value has one of the JSON types.
	 *
	 * @param mixed           $value Value.
	 * @param string|string[] $types Types.
	 */
	private static function has_type( $value, $types ): bool {
		foreach ( (array) $types as $type ) {
			$fits = match ( $type ) {
				'object'  => is_object( $value ),
				'array'   => is_array( $value ),
				'string'  => is_string( $value ),
				'integer' => is_int( $value ) || ( is_float( $value ) && floor( $value ) === $value && is_finite( $value ) ),
				'number'  => is_int( $value ) || is_float( $value ),
				'boolean' => is_bool( $value ),
				'null'    => null === $value,
				default   => false,
			};
			if ( $fits ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Whether a value is one of the allowed ones.
	 *
	 * @param mixed            $value   Value.
	 * @param array<int,mixed> $allowed Allowed values.
	 */
	private static function in( $value, array $allowed ): bool {
		foreach ( $allowed as $candidate ) {
			if ( self::same( $value, $candidate ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * JSON equality (1 and 1.0 are equal, as in JSON Schema).
	 *
	 * @param mixed $a Value.
	 * @param mixed $b Value.
	 */
	private static function same( $a, $b ): bool {
		if ( ( is_int( $a ) || is_float( $a ) ) && ( is_int( $b ) || is_float( $b ) ) ) {
			return (float) $a === (float) $b;
		}
		return self::json( $a ) === self::json( $b );
	}

	/**
	 * JSON of a value.
	 *
	 * @param mixed $value Value.
	 */
	private static function json( $value ): string {
		return (string) json_encode( $value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ); // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode -- also used without WordPress (unit tests).
	}

	/**
	 * A property name as a JSON pointer segment.
	 *
	 * @param string $name Name.
	 */
	private static function escape( string $name ): string {
		return str_replace( array( '~', '/' ), array( '~0', '~1' ), $name );
	}

	/**
	 * Records a problem.
	 *
	 * @param string $path    Path.
	 * @param string $message Message.
	 */
	private function error( string $path, string $message ): void {
		if ( count( $this->errors ) < self::MAX_ERRORS ) {
			$this->errors[] = ( '' === $path ? '/' : $path ) . ': ' . $message;
		}
	}
}
