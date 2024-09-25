<?php


add_action('init', 'fnsf_af2_v_migration');

function fnsf_af2_v_migration() {
    $af2_version_num_ = intval(get_option('af2_version_num_'));

    if($af2_version_num_ < 3) {

        $kontaktformular_posts = get_posts([
            'post_type' => FNSF_KONTAKTFNSF_FORMULAR_POST_TYPE,
            'post_status' => 'any',
            'numberposts' => -1,
            'order'    => 'ASC'
        ]);
        
        foreach($kontaktformular_posts as $post) {
            require_once FNSF_AF2_MISC_FUNCTIONS_PATH;
            $post_content = fnsf_af2_get_post_content($post);

            $id = get_post_field( 'ID', $post );

            $post_content['show_bottombar'] = empty($post_content['show_bottombar']) ? false : true;
            $post_content['use_autorespond'] = empty($post_content['use_autorespond']) ? false : true;
            $post_content['use_smtp'] = empty($post_content['use_smtp']) ? false : true;
            $post_content['use_wp_mail'] = empty($post_content['use_wp_mail']) ? false : true;
            
            wp_update_post( array('ID' => $id, 'post_content' => urlencode(serialize($post_content))));
        }

        update_option('af2_version_num_', '3');
    }
}