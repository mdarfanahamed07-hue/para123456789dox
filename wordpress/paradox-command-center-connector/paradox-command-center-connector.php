<?php
/**
 * Plugin Name: Paradox Command Center Connector
 * Description: Secure, capability-gated REST bridge for the Paradox Command Center Windows application.
 * Version: 1.0.0
 * Author: Paradox Prime
 * Requires at least: 6.4
 * Requires PHP: 7.4
 * License: GPL-2.0-or-later
 */

if (!defined('ABSPATH')) {
    exit;
}

final class Paradox_Command_Center_Connector {
    const VERSION = '1.0.0';
    const NS = 'paradox-command-center/v1';
    const LOG_OPTION = 'ppcc_activity_log';
    const MAX_LOG_ROWS = 200;

    public function __construct() {
        add_action('rest_api_init', array($this, 'register_routes'));
    }

    public function register_routes() {
        register_rest_route(self::NS, '/status', array(
            'methods' => WP_REST_Server::READABLE,
            'callback' => array($this, 'status'),
            'permission_callback' => array($this, 'permission'),
        ));
        register_rest_route(self::NS, '/plugins', array(
            'methods' => WP_REST_Server::READABLE,
            'callback' => array($this, 'plugins'),
            'permission_callback' => array($this, 'permission'),
        ));
        foreach (array('install', 'activate', 'deactivate', 'update', 'delete') as $action) {
            register_rest_route(self::NS, '/plugins/' . $action, array(
                'methods' => WP_REST_Server::CREATABLE,
                'callback' => array($this, 'plugin_' . $action),
                'permission_callback' => array($this, 'permission'),
            ));
        }
        register_rest_route(self::NS, '/themes', array(
            'methods' => WP_REST_Server::READABLE,
            'callback' => array($this, 'themes'),
            'permission_callback' => array($this, 'permission'),
        ));
        foreach (array('install', 'activate', 'update', 'delete') as $action) {
            register_rest_route(self::NS, '/themes/' . $action, array(
                'methods' => WP_REST_Server::CREATABLE,
                'callback' => array($this, 'theme_' . $action),
                'permission_callback' => array($this, 'permission'),
            ));
        }
        register_rest_route(self::NS, '/activity', array(
            'methods' => WP_REST_Server::READABLE,
            'callback' => array($this, 'activity'),
            'permission_callback' => array($this, 'permission'),
        ));
    }

    public function permission() {
        return is_user_logged_in() && current_user_can('manage_options');
    }

    private function require_capability($capability) {
        if (!current_user_can($capability)) {
            return new WP_Error('ppcc_forbidden', 'Your WordPress account does not have the required permission for this action.', array('status' => 403));
        }
        return true;
    }

    private function result($message, $data = array(), $status = 200) {
        return new WP_REST_Response(array_merge(array('success' => true, 'message' => $message), $data), $status);
    }

    private function fail($code, $message, $status = 400) {
        return new WP_Error($code, $message, array('status' => $status));
    }

    private function log_action($action, $target, $success, $message) {
        $rows = get_option(self::LOG_OPTION, array());
        if (!is_array($rows)) {
            $rows = array();
        }
        array_unshift($rows, array(
            'time' => current_time('mysql', true),
            'user_id' => get_current_user_id(),
            'user' => wp_strip_all_tags(wp_get_current_user()->user_login),
            'action' => sanitize_key($action),
            'target' => sanitize_text_field((string) $target),
            'success' => (bool) $success,
            'message' => sanitize_text_field((string) $message),
        ));
        $rows = array_slice($rows, 0, self::MAX_LOG_ROWS);
        update_option(self::LOG_OPTION, $rows, false);
    }

    public function status() {
        global $wpdb;
        $active_plugins = (array) get_option('active_plugins', array());
        if (is_multisite()) {
            $active_plugins = array_unique(array_merge($active_plugins, array_keys((array) get_site_option('active_sitewide_plugins', array()))));
        }
        $memory_limit = ini_get('memory_limit');
        return $this->result('Website connection is healthy.', array(
            'site_title' => get_bloginfo('name'),
            'site_url' => home_url('/'),
            'wp_version' => get_bloginfo('version'),
            'php_version' => PHP_VERSION,
            'mysql_version' => method_exists($wpdb, 'db_version') ? $wpdb->db_version() : '',
            'memory_limit' => $memory_limit ? (string) $memory_limit : 'Unknown',
            'active_plugins' => count(array_unique($active_plugins)),
            'active_theme' => wp_get_theme()->get('Name'),
            'multisite' => is_multisite(),
            'server_time_utc' => gmdate('c'),
            'connector_version' => self::VERSION,
            'current_user' => get_current_user_id(),
        ));
    }

    public function plugins() {
        if (!function_exists('get_plugins')) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }
        $all = get_plugins();
        $updates = get_site_transient('update_plugins');
        $network_active = (array) get_site_option('active_sitewide_plugins', array());
        $items = array();
        foreach ($all as $basename => $data) {
            $update = (is_object($updates) && isset($updates->response[$basename])) ? $updates->response[$basename] : null;
            $items[] = array(
                'basename' => $basename,
                'name' => sanitize_text_field($data['Name']),
                'version' => sanitize_text_field($data['Version']),
                'author' => wp_strip_all_tags($data['Author']),
                'description' => sanitize_text_field(wp_strip_all_tags($data['Description'])),
                'active' => is_plugin_active($basename),
                'network_active' => isset($network_active[$basename]),
                'update_available' => (bool) $update,
                'new_version' => $update && isset($update->new_version) ? sanitize_text_field($update->new_version) : '',
            );
        }
        usort($items, function ($a, $b) { return strcasecmp($a['name'], $b['name']); });
        return $this->result('Plugin list loaded.', array('plugins' => $items));
    }

    private function plugin_exists($basename) {
        if (!function_exists('get_plugins')) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }
        $all = get_plugins();
        return isset($all[$basename]);
    }

    private function clean_plugin_basename($request) {
        $basename = sanitize_text_field((string) $request->get_param('plugin'));
        if (!$basename || strpos($basename, '..') !== false || strpos($basename, '\\') !== false || strpos($basename, '/') === false || basename($basename) === '') {
            return '';
        }
        return $basename;
    }

    public function plugin_install($request) {
        $cap = $this->require_capability('install_plugins');
        if (is_wp_error($cap)) return $cap;
        $files = $request->get_file_params();
        $file = isset($files['package']) ? $files['package'] : null;
        if (!$file || !isset($file['tmp_name'], $file['name'], $file['error'], $file['size'])) {
            $this->log_action('plugin_install', 'unknown', false, 'No uploaded ZIP was received.');
            return $this->fail('ppcc_missing_upload', 'Choose a plugin ZIP file to upload.');
        }
        if ((int) $file['error'] !== UPLOAD_ERR_OK || (int) $file['size'] < 1 || (int) $file['size'] > 20 * MB_IN_BYTES) {
            $this->log_action('plugin_install', $file['name'], false, 'Upload failed size or PHP upload validation.');
            return $this->fail('ppcc_upload_invalid', 'The plugin ZIP upload failed or exceeds the 20 MB limit.');
        }
        if (strtolower(pathinfo($file['name'], PATHINFO_EXTENSION)) !== 'zip' || !class_exists('ZipArchive')) {
            $this->log_action('plugin_install', $file['name'], false, 'Invalid ZIP or ZIP support unavailable.');
            return $this->fail('ppcc_zip_invalid', 'A valid ZIP archive and PHP ZIP support are required.');
        }
        $zip = new ZipArchive();
        if ($zip->open($file['tmp_name']) !== true) {
            $this->log_action('plugin_install', $file['name'], false, 'ZIP archive could not be opened.');
            return $this->fail('ppcc_zip_invalid', 'The uploaded file is not a readable ZIP archive.');
        }
        $valid_entries = $zip->numFiles > 0 && $zip->numFiles <= 5000;
        $zip->close();
        if (!$valid_entries) {
            $this->log_action('plugin_install', $file['name'], false, 'ZIP entry count outside permitted range.');
            return $this->fail('ppcc_zip_invalid', 'The ZIP archive is empty or contains too many entries.');
        }
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
        $skin = new Automatic_Upgrader_Skin();
        $upgrader = new Plugin_Upgrader($skin);
        $installed = $upgrader->install($file['tmp_name']);
        if (is_wp_error($installed) || !$installed) {
            $message = is_wp_error($installed) ? $installed->get_error_message() : 'WordPress could not install this plugin.';
            $this->log_action('plugin_install', $file['name'], false, $message);
            return $this->fail('ppcc_install_failed', $message, 500);
        }
        $this->log_action('plugin_install', $file['name'], true, 'Plugin installed; it was not automatically activated.');
        return $this->result('Plugin installed. Review it in the list, then activate it when ready.', array('plugin' => $upgrader->plugin_info(), 'activated' => false), 201);
    }

    public function plugin_activate($request) {
        $cap = $this->require_capability('activate_plugins');
        if (is_wp_error($cap)) return $cap;
        $basename = $this->clean_plugin_basename($request);
        if (!$basename || !$this->plugin_exists($basename)) return $this->fail('ppcc_plugin_missing', 'The selected plugin was not found.', 404);
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
        if (is_plugin_active($basename)) return $this->result('Plugin is already active.');
        if (is_plugin_active_for_network($basename)) return $this->fail('ppcc_network_plugin', 'This plugin is network-active. Manage it from the WordPress Network Admin.');
        $error = activate_plugin($basename, '', false, true);
        if (is_wp_error($error)) {
            $this->log_action('plugin_activate', $basename, false, $error->get_error_message());
            return $this->fail('ppcc_activation_failed', $error->get_error_message(), 500);
        }
        $this->log_action('plugin_activate', $basename, true, 'Plugin activated.');
        return $this->result('Plugin activated.');
    }

    public function plugin_deactivate($request) {
        $cap = $this->require_capability('activate_plugins');
        if (is_wp_error($cap)) return $cap;
        $basename = $this->clean_plugin_basename($request);
        if (!$basename || !$this->plugin_exists($basename)) return $this->fail('ppcc_plugin_missing', 'The selected plugin was not found.', 404);
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
        if (is_plugin_active_for_network($basename)) return $this->fail('ppcc_network_plugin', 'This plugin is network-active. Manage it from WordPress Network Admin.');
        if (!is_plugin_active($basename)) return $this->result('Plugin is already inactive.');
        deactivate_plugins($basename, false, false);
        $this->log_action('plugin_deactivate', $basename, true, 'Plugin deactivated.');
        return $this->result('Plugin deactivated.');
    }

    public function plugin_update($request) {
        $cap = $this->require_capability('update_plugins');
        if (is_wp_error($cap)) return $cap;
        $basename = $this->clean_plugin_basename($request);
        if (!$basename || !$this->plugin_exists($basename)) return $this->fail('ppcc_plugin_missing', 'The selected plugin was not found.', 404);
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
        $skin = new Automatic_Upgrader_Skin();
        $upgrader = new Plugin_Upgrader($skin);
        $updated = $upgrader->upgrade($basename);
        if (is_wp_error($updated) || !$updated) {
            $message = is_wp_error($updated) ? $updated->get_error_message() : 'No update was applied. Check the WordPress update transient and filesystem permissions.';
            $this->log_action('plugin_update', $basename, false, $message);
            return $this->fail('ppcc_update_failed', $message, 500);
        }
        $this->log_action('plugin_update', $basename, true, 'Plugin updated.');
        return $this->result('Plugin updated.');
    }

    public function plugin_delete($request) {
        $cap = $this->require_capability('delete_plugins');
        if (is_wp_error($cap)) return $cap;
        $basename = $this->clean_plugin_basename($request);
        if (!$basename || !$this->plugin_exists($basename)) return $this->fail('ppcc_plugin_missing', 'The selected plugin was not found.', 404);
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
        if (is_plugin_active($basename) || is_plugin_active_for_network($basename)) return $this->fail('ppcc_plugin_active', 'Deactivate this plugin before deleting it. Network-active plugins cannot be deleted here.');
        $deleted = delete_plugins(array($basename));
        if (is_wp_error($deleted) || !$deleted) {
            $message = is_wp_error($deleted) ? $deleted->get_error_message() : 'WordPress could not delete this plugin.';
            $this->log_action('plugin_delete', $basename, false, $message);
            return $this->fail('ppcc_delete_failed', $message, 500);
        }
        $this->log_action('plugin_delete', $basename, true, 'Plugin files deleted. Plugin data may remain in the database.');
        return $this->result('Plugin deleted. Its database data may remain; this connector does not erase plugin data.');
    }

    public function themes() {
        $all = wp_get_themes();
        $updates = get_site_transient('update_themes');
        $active = get_stylesheet();
        $parent = get_template();
        $items = array();
        foreach ($all as $stylesheet => $theme) {
            $update = (is_object($updates) && isset($updates->response[$stylesheet])) ? $updates->response[$stylesheet] : null;
            $items[] = array(
                'stylesheet' => $stylesheet,
                'name' => sanitize_text_field($theme->get('Name')),
                'version' => sanitize_text_field($theme->get('Version')),
                'author' => wp_strip_all_tags($theme->get('Author')),
                'description' => sanitize_text_field(wp_strip_all_tags($theme->get('Description'))),
                'active' => ($stylesheet === $active),
                'parent_active' => ($stylesheet === $parent),
                'update_available' => (bool) $update,
                'new_version' => $update && isset($update['new_version']) ? sanitize_text_field($update['new_version']) : '',
            );
        }
        usort($items, function ($a, $b) { return strcasecmp($a['name'], $b['name']); });
        return $this->result('Theme list loaded.', array('themes' => $items));
    }

    private function clean_theme_slug($request) {
        $slug = sanitize_text_field((string) $request->get_param('theme'));
        if (!$slug || strpos($slug, '..') !== false || strpos($slug, '/') !== false || strpos($slug, '\\') !== false) return '';
        return $slug;
    }

    public function theme_install($request) {
        $cap = $this->require_capability('install_themes');
        if (is_wp_error($cap)) return $cap;
        $files = $request->get_file_params();
        $file = isset($files['package']) ? $files['package'] : null;
        if (!$file || !isset($file['tmp_name'], $file['name'], $file['error'], $file['size'])) {
            $this->log_action('theme_install', 'unknown', false, 'No uploaded ZIP was received.');
            return $this->fail('ppcc_missing_upload', 'Choose a theme ZIP file to upload.');
        }
        if ((int) $file['error'] !== UPLOAD_ERR_OK || (int) $file['size'] < 1 || (int) $file['size'] > 30 * MB_IN_BYTES) {
            $this->log_action('theme_install', $file['name'], false, 'Upload failed size or PHP upload validation.');
            return $this->fail('ppcc_upload_invalid', 'The theme ZIP upload failed or exceeds the 30 MB limit.');
        }
        if (strtolower(pathinfo($file['name'], PATHINFO_EXTENSION)) !== 'zip' || !class_exists('ZipArchive')) {
            $this->log_action('theme_install', $file['name'], false, 'Invalid ZIP or ZIP support unavailable.');
            return $this->fail('ppcc_zip_invalid', 'A valid ZIP archive and PHP ZIP support are required.');
        }
        $zip = new ZipArchive();
        if ($zip->open($file['tmp_name']) !== true) {
            $this->log_action('theme_install', $file['name'], false, 'ZIP archive could not be opened.');
            return $this->fail('ppcc_zip_invalid', 'The uploaded file is not a readable ZIP archive.');
        }
        $valid_entries = $zip->numFiles > 0 && $zip->numFiles <= 10000;
        $zip->close();
        if (!$valid_entries) {
            $this->log_action('theme_install', $file['name'], false, 'ZIP entry count outside permitted range.');
            return $this->fail('ppcc_zip_invalid', 'The ZIP archive is empty or contains too many entries.');
        }
        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/theme.php';
        require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
        $skin = new Automatic_Upgrader_Skin();
        $upgrader = new Theme_Upgrader($skin);
        $installed = $upgrader->install($file['tmp_name']);
        if (is_wp_error($installed) || !$installed) {
            $message = is_wp_error($installed) ? $installed->get_error_message() : 'WordPress could not install this theme.';
            $this->log_action('theme_install', $file['name'], false, $message);
            return $this->fail('ppcc_install_failed', $message, 500);
        }
        $this->log_action('theme_install', $file['name'], true, 'Theme installed; it was not automatically activated.');
        return $this->result('Theme installed. Review it in the list, then activate it when ready.', array('theme' => $upgrader->theme_info(), 'activated' => false), 201);
    }

    public function theme_activate($request) {
        $cap = $this->require_capability('switch_themes');
        if (is_wp_error($cap)) return $cap;
        $slug = $this->clean_theme_slug($request);
        $theme = $slug ? wp_get_theme($slug) : false;
        if (!$theme || !$theme->exists()) return $this->fail('ppcc_theme_missing', 'The selected theme was not found.', 404);
        if ($slug === get_stylesheet()) return $this->result('This theme is already active.');
        switch_theme($slug);
        $this->log_action('theme_activate', $slug, true, 'Theme activated.');
        return $this->result('Theme activated.');
    }

    public function theme_update($request) {
        $cap = $this->require_capability('update_themes');
        if (is_wp_error($cap)) return $cap;
        $slug = $this->clean_theme_slug($request);
        $theme = $slug ? wp_get_theme($slug) : false;
        if (!$theme || !$theme->exists()) return $this->fail('ppcc_theme_missing', 'The selected theme was not found.', 404);
        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
        $skin = new Automatic_Upgrader_Skin();
        $upgrader = new Theme_Upgrader($skin);
        $updated = $upgrader->upgrade($slug);
        if (is_wp_error($updated) || !$updated) {
            $message = is_wp_error($updated) ? $updated->get_error_message() : 'No update was applied. Check the WordPress update transient and filesystem permissions.';
            $this->log_action('theme_update', $slug, false, $message);
            return $this->fail('ppcc_update_failed', $message, 500);
        }
        $this->log_action('theme_update', $slug, true, 'Theme updated.');
        return $this->result('Theme updated.');
    }

    public function theme_delete($request) {
        $cap = $this->require_capability('delete_themes');
        if (is_wp_error($cap)) return $cap;
        $slug = $this->clean_theme_slug($request);
        $theme = $slug ? wp_get_theme($slug) : false;
        if (!$theme || !$theme->exists()) return $this->fail('ppcc_theme_missing', 'The selected theme was not found.', 404);
        if ($slug === get_stylesheet() || $slug === get_template()) return $this->fail('ppcc_theme_active', 'The active theme or its parent cannot be deleted. Switch to another theme first.');
        $deleted = delete_theme($slug);
        if (is_wp_error($deleted) || !$deleted) {
            $message = is_wp_error($deleted) ? $deleted->get_error_message() : 'WordPress could not delete this theme.';
            $this->log_action('theme_delete', $slug, false, $message);
            return $this->fail('ppcc_delete_failed', $message, 500);
        }
        $this->log_action('theme_delete', $slug, true, 'Theme files deleted.');
        return $this->result('Theme deleted.');
    }

    public function activity() {
        $rows = get_option(self::LOG_OPTION, array());
        if (!is_array($rows)) $rows = array();
        return $this->result('Activity log loaded.', array('events' => array_values($rows)));
    }
}

new Paradox_Command_Center_Connector();
