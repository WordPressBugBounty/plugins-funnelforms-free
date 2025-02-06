<div class="af2_settings_wrapper">
    <div class="af2_card">
        <div class="af2_card_block">
            <div class="af2_lead_settings_block">
                <h4><?= __('Lead settings', 'funnelforms-free') ?></h4>
                <div class="af2_toggle_wrapper mt20">
                    <input type="checkbox" id="af2_auto_delete_leads_enabled" class="af2_toggle af2_edit_content_checkbox" value="false" disabled>
                    <label for="af2_auto_delete_leads_enabled" class="af2_toggle_btn"></label>
                    <p class="af2_toggle_label ml5"><?= __('Automatically delete leads after a period of time?', 'funnelforms-free') ?></p>
                </div>
                <div id="lead_auto_delete_threshold_form" class="custom_builder_content_card_box mt20">
                    <div class="custom_builder_content_card_box_heading">
                        <p><?= __('Deletion period', 'funnelforms-free') ?></p>
                    </div>
                    <div class="custom_builder_content_card_box_content af2_deletion_period_wrapper">
                        <input type="number" min="1" step="1" class="af2_edit_content_input" id="af2_auto_delete_leads_threshold_value" value="">
                        <select class="af2_edit_content_select" id="af2_auto_delete_leads_threshold_unit" diasbled>
                        </select>
                    </div>
                </div>
                <button type="submit" id="af2_save_settings_leads_button" class="af2_btn af2_btn_primary mt20"><?= __('Save', 'funnelforms-free') ?>
                    <span class="af2_hide loading">&nbsp;<i class="fas fa-circle-notch fa-spin"></i></span>
                </button>
            </div>
        </div>
    </div>
</div>