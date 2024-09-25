<?php

require_once FNSF_AF2_MENU_PARENTS_CLASS;

class Fnsf_Af2Dashboard extends Fnsf_Af2MenuCustom {
    
    protected function fnsf_get_heading() { return __('Dashboard', 'funnelforms-free'); }
    protected function fnsf_get_menu_custom_template() { return FNSF_AF2_CUSTOM_MENU_DASHBOARD; }

    protected function fnsf_get_menu_blur_option_() { return true; }

    protected function fnsf_load_resources() {
        wp_enqueue_style('af2_dashboard_style');
        parent::fnsf_load_resources();
    }
}