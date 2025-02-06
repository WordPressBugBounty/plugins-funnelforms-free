<?php

require_once FNSF_AF2_MENU_PARENTS_CLASS;
class Fnsf_Af2Settings extends Fnsf_Af2MenuCustom {

    protected function fnsf_get_heading() { return 'Settings'; }
    protected function fnsf_get_menu_custom_template() { return FNSF_AF2_CUSTOM_MENU_SETTINGS; }

    protected function fnsf_get_menu_blur_option_() { return true; }
    
    protected function fnsf_get_af2_custom_contents_() { }

    protected function fnsf_load_resources() {
        wp_enqueue_style('af2_settings_style');
        parent::fnsf_load_resources();
    }

}