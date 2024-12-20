<?php
class Array_Serializer {
    /**
     * Verify that a value contains only arrays and scalar values
     * 
     * @param mixed $data Data to check
     * @return bool True if data is safe
     */
    private static function is_safe_array($data) {
        if (is_scalar($data) || is_null($data)) {
            return true;
        }
        
        if (!is_array($data)) {
            return false;
        }
        
        foreach ($data as $value) {
            if (!self::is_safe_array($value)) {
                return false;
            }
        }
        
        return true;
    }

    /**
     * Safely serialize array data
     * 
     * @param array $data Array to serialize
     * @return string|false Serialized data or false on failure
     */
    public static function secure_serialize($data) {
        if (!is_array($data) || !self::is_safe_array($data)) {
            return false;
        }
        
        return urlencode(serialize($data));
    }

    /**
     * Safely unserialize data into array
     * 
     * @param string $data Data to unserialize
     * @return array|false Array on success, false on failure
     */
    public static function secure_unserialize($data) {
        if (empty($data)) {
            return false;
        }

        $unserialized = @unserialize($data, [
            "allowed_classes" => false,
        ]);
        
        // Verify we got an array back and all nested values are safe
        if (!is_array($unserialized) || !self::is_safe_array($unserialized)) {
            return false;
        }

        return $unserialized;
    }
}