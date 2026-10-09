export default {
  persona: {
    description: `Manage personality presets`,
    "image-tags": {
      modal_title: `Persona Image Tags`,
      tags_input_label: `Physical Appearance Tags`,
      tags_input_description: `Comma-separated imageboard-style tags for this persona's physical appearance. Leave empty to clear.`,
      tags_input_placeholder: `short white hair, red eyes, school uniform`,
      no_tags_title: `No Tags Provided`,
      no_tags_description: `Please provide at least one physical appearance tag.`,
      too_many_tags_title: `Too Many Tags`,
      too_many_tags_description: `You can set a maximum of {max_tags} image tags per persona.`,
      tag_too_long_title: `Tag Too Long`,
      tag_too_long_description: `Each image tag must be {max_length} characters or less.`,
      success_title: `Physical Appearance Updated`,
      success_description: `Updated physical appearance tags for **{persona_name}**:
\`\`\`
{tag_list}
\`\`\``,
      cleared_title: `Physical Appearance Cleared`,
      cleared_description: `Cleared physical appearance tags for **{persona_name}**.`,
    },
    sprites: {
      add: {
        sprite_name_label: `Sprite Name`,
        sprite_name_description: `Label used for the sprite. Reusing a label replaces the corresponding sprite.`,
        sprite_name_placeholder: `mad`,
        image_label: `Sprite Image`,
        image_description: `Upload a PNG, JPG, or GIF. It will be converted to PNG.`,
        instructions_label: `Usage Instructions`,
        instructions_description: `Optional guidance for when this sprite should be used.`,
        instructions_placeholder: `Use when angry, annoyed, or visibly upset.`,
        identity_label: `Save as Identity`,
        identity_description: `Show the decorated "Sprite (Persona)" name in Discord, useful for alter identities. Off = normal.`,
      },
      edit: {
        image_description: `Optional. Upload PNG, JPG, or GIF to replace the sprite image.`,
        identity_status_on: `Identity`,
        identity_status_off: `Normal sprite`,
      },
      import: {
        archive_label: `Sprite Archive`,
        archive_description: `Upload a .zip created by /persona sprites export.`,
      },
    },
    attribute: {
      description: `Manage persona attributes.`,
      add: {
        description: `Add an attribute to a persona.`,
      },
      remove: {
        description: `Remove an attribute from a persona.`,
      },
    },
    prompt: {
      description: `Manage persona prompt instructions.`,
      set: {
        description: `Set a persona prompt.`,
      },
      remove: {
        description: `Remove a persona prompt.`,
      },
    },
    "sample-dialogue": {
      description: `Add a sample user/bot dialogue pair to as an example for how I should respond.`,
      add: {
        description: `Add a sample user/bot dialogue pair to as an example for how I should respond.`,
      },
      remove: {
        description: `Remove a sample user/bot dialogue pair from my memory.`,
      },
    },
    name_conflict_title: `Persona Name Conflict`,
    name_conflict_description: `A persona named **{name}** already exists on this server. Persona names must be unique within a server.`,
    export: {
      description: `Export current personality as a shareable PNG file`,
      export_json_select_label: `Export JSON`,
      export_json_select_description: `Optional: export an importable JSON file instead (no avatar image)`,
      persona_modal_title: `Select Persona`,
      persona_select_label: `Persona`,
      persona_select_description: `Choose which persona to export.`,
      persona_select_placeholder: `Select a persona...`,
      main_persona_description: `Main Persona`,
      alter_persona_description: `Alter Persona`,
      success_title: `Persona Exported Successfully`,
      success_description: `Current persona **{nickname}** has been exported! Share this PNG file with others to spread this personality configuration.`,
      success_description_json: `Current persona **{nickname}** has been exported as a JSON file.

**Note:** This JSON can be re-imported with \`/persona import\`. It does not include the avatar image. Use the PNG export to share the avatar too.`,
      json_importable_note: `This JSON export can be imported with /persona import. It does not include the avatar image; use the PNG export to share the avatar too.`,
      failed_title: `Export Failed`,
      avatar_failed_title: `Avatar Download Failed`,
      avatar_failed_description: `Failed to download the persona avatar. Please try again later.`,
      embed_failed_title: `PNG Processing Failed`,
      embed_failed_description: `Failed to embed metadata into the PNG file. Please try again.`,
      error_no_server_data: `Server not found in database. Please run /setup first.`,
      error_no_preset_data: `Persona data not found. Please run /setup first.`,
      error_validation_failed: `Failed to validate export data structure`,
      error_export_failed: `Failed to export persona data`,
    },
    import: {
      description: `Import a persona from a PNG, JSON, or CHARX file`,
      file_description: `PNG, JSON, or CHARX file containing persona data`,
      type_description: `Import as main persona or alter persona`,
      triggers_description: `Optional extra triggers, comma-separated ("," or "、")`,
      memories_description: `Preserve this persona's user and server memories?`,
      memories_choice_preserve: `Yes, preserve user/server memories`,
      memories_choice_fork: `No, start fresh user/server memories`,
      type_choice_main: `Main Persona (replaces current persona)`,
      type_choice_alter: `Alter Persona`,
      success_title: `Persona Imported Successfully`,
      success_description: `Successfully imported persona **{nickname}**!
Attributes: {attribute_count}
Sample Dialogues: {dialogue_count}
Trigger Words: {trigger_word_count}`,
      success_confirmation: `Successfully imported main persona **{nickname}**! The detailed import information has been posted in the channel.`,
      post_missing_permission: `Persona imported, but I could not post the public confirmation. Ask a server administrator to grant me {permission} in this channel.`,
      nickname_update_success: `Server nickname has been updated.`,
      nickname_update_failed: `🟡 Server nickname could not be updated, likely due to Discord rate limits. Please change it manually instead.`,
      avatar_update_success: `Server avatar has been updated.`,
      avatar_update_skipped_no_image: `🟡 The imported file did not include an avatar image, so the current main persona avatar was kept.`,
      avatar_update_rate_limited: `🟡 Server avatar was not updated due to Discord rate limits. Please change it manually instead.`,
      avatar_update_failed: `🟡 Server avatar could not be updated, likely due to Discord rate limits. Please change it manually instead.`,
      alter_success_title: `Alter Persona Imported Successfully`,
      alter_success_description: `Successfully imported alter persona **{nickname}**!
Unique Trigger Words: {trigger_count}
Triggers: {triggers}

This persona will respond when these triggers appear in messages.`,
      alter_success_confirmation: `Successfully imported alter persona **{nickname}** with {trigger_count} unique trigger words! The detailed import information has been posted in the channel.`,
      alter_avatar_fallback_main: `🟡 This import did not include an avatar image, so this alter is using **{nickname}**'s current main persona avatar as a fallback. You can use \`/config\` > Persona > General to change it.`,
      alter_avatar_warning: `⚠️ Do not delete the avatar image embed above, or the alter persona avatar will be lost.`,
      alter_dm_not_allowed_title: `Alter Personas Not Allowed in DMs`,
      alter_dm_not_allowed_description: `Alter personas can only be imported in servers, not in Direct Messages. Please run this command in a server.`,
      alter_no_triggers_warning: `⚠️ This persona has no trigger words. It won't respond to any messages until you add triggers using \`/config\` > Persona > General.`,
      alter_name_conflict_title: `Persona Name Already Exists`,
      alter_name_conflict_description: `A persona with the name **{name}** already exists on this server. Each persona must have a unique name.

Please edit the import file to use a different name, or remove the existing persona using \`/persona remove\`.`,
      alter_limit_title: `Persona Limit Reached`,
      alter_limit_description: `This server already has {current} personas. The maximum allowed is {max}. Please remove an alter with \`/persona remove\` before importing a new one.`,
      failed_title: `Import Failed`,
      failed_description: `Failed to import the persona. Please check the file and try again.`,
      sprite_snapshot_failed_description: `The import was cancelled because the current persona sprites could not be read. No persona data was changed. Please try again.`,
      sprite_cleanup_failed_description: `The persona was imported, but its previous sprite rows could not be cleared. The import is incomplete. Please try again or contact an administrator.`,
      sprite_storage_cleanup_partial_description: `The persona was imported, but {failed_count} previous sprite image(s) could not be deleted from storage.`,
      invalid_file_type_title: `Invalid File Type`,
      invalid_file_type_description: `Please upload a valid .png, .json, or .charx file containing persona data.`,
      file_too_large_title: `File Too Large`,
      file_too_large_description: `The file is too large. Maximum file size is {max_size}MB.`,
      download_failed_title: `Download Failed`,
      download_failed_description: `Failed to download the attached file. Please try again.`,
      invalid_charx_title: `Invalid Character Card Archive`,
      invalid_charx_description: `This .charx file could not be read as a Character Card V3 archive. Download the card again from the site that hosts it, or export the card as a .png instead.`,
      card_conversion_failed_title: `Character Card Detected, Conversion Failed`,
      card_conversion_failed_description: `A card was decoded from **{source}**, but converting it to Tomori format failed. The decoded payload is attached for inspection. Please report this through \`/support discord\` and include the attached file.`,
      charx_not_card_description: `This .charx archive opened, but the card inside is not a character card. Make sure the file is the character card itself and not another archive from the same download.`,
      charx_too_large_description: `The card inside this archive is too large to import. Maximum card size is {max_size}MB.`,
      charx_assets_too_large_description: `This card bundles more media than an import can inspect. Try a card exported without its image, audio, or video assets.`,
      charx_assets_ignored_description: `🟡 This card's bundled images, sounds, and other media were not imported. Only the persona text was read. You can set an avatar with \`/server avatar\` and add sprites under \`/config\` > Persona > Sprites.`,
      invalid_png_title: `Invalid PNG File`,
      invalid_png_description: `The uploaded file is not a valid PNG image.`,
      no_metadata_title: `No Persona Data Found`,
      no_metadata_description: `This file doesn't contain supported persona data. Use a file exported by \`/persona export\` or a supported SillyTavern character card.`,
      invalid_file_title: `Invalid Persona File`,
      invalid_file_description: `The persona file format is invalid or incompatible.`,
      no_permission_title: `Permission Denied`,
      no_permission_description: `You need the **Manage Server** permission to import personas.`,
      error_download_timeout: `File download timed out. Please try again.`,
      error_invalid_attribute: `Invalid attribute content: {details}`,
      error_attribute_flags_mismatch: `Attribute visibility flags must match the attribute list length.`,
      error_invalid_dialogue_in: `Invalid sample dialogue (input): {details}`,
      error_invalid_dialogue_out: `Invalid sample dialogue (output): {details}`,
      error_invalid_trigger_word: `Invalid trigger word: {details}`,
      error_dialogue_mismatch: `Sample dialogue arrays don't match in length`,
      error_invalid_config: `Invalid configuration fields in persona data`,
      error_no_server_data: `Server not found in database. Please run \`/setup\` first.`,
      error_name_conflict: `A persona with the name **{name}** already exists on this server. Please use a different name.`,
      error_nsfw_persona: `This persona is marked as NSFW, so \`/persona import\` can't load it. Use \`/nsfw persona import\` instead.`,
      error_import_failed: `Failed to import persona data`,
      error_not_json: `The imported file must contain valid JSON data`,
      error_incompatible_version: `Incompatible preset version. Expected {expected}, got {actual}`,
      error_invalid_format: `Invalid persona file format`,
      error_invalid_type: `Invalid persona type: {type}. Expected "preset"`,
      avatar_update_skipped_dm: `Persona was imported successfully, except avatar and nickname updates which are not available in Direct Messages`,
      refresh_reminder: `Run \`/refresh\` to apply persona update in this chat`,
    },
    remove: {
      description: `Remove an alter persona from the server`,
      no_permission_title: `Permission Denied`,
      no_permission_description: `You need the **Manage Server** permission to remove alter personas.`,
      modal_title: `Remove Alter Persona`,
      select_label: `Alter Persona`,
      select_placeholder: `Choose an alter persona to remove...`,
      no_alters_error_title: `No Alter Personas`,
      no_alters_error_description: `There are no alter personas to remove. Import alter personas using \`/persona import type:alter\`.`,
      success_title: `Alter Persona Removed`,
      success_description: `Successfully removed alter persona **{nickname}**.`,
    },
    default: {
      description: `Apply a preset personality configuration`,
      type_description: `Target main/default persona or create as alter persona`,
      type_choice_default: `Main Persona (replaces current persona)`,
      type_choice_alter: `Alter Persona`,
      no_permission_title: `Permission Denied`,
      no_permission_description: `You need the **Manage Server** permission to apply personality presets.`,
      modal_title: `Apply Personality Preset`,
      select_label: `Personality Preset`,
      select_description: `Choose a preset to apply. This will overwrite current attributes and dialogues.`,
      select_placeholder: `Choose a preset...`,
      no_presets_title: `No Presets Available`,
      no_presets_description: `There are no personality presets available for your language. Please report through \`/support discord\`.`,
      preset_not_found: `The selected preset could not be found.`,
      success_title: `Preset Applied`,
      success_details_description: `Successfully applied preset **{preset_name}** to persona **{nickname}**!
Attributes: {attribute_count}
Sample Dialogues: {dialogue_count}
Trigger Words ({trigger_word_count}): {triggers}`,
      success_confirmation: `Preset applied to **{nickname}**. Detailed information has been posted in this channel.`,
      avatar_update_failed: `🟡️ Server avatar could not be updated due to a Discord API error, but persona was applied successfully.`,
      avatar_update_skipped_dm: `Preset was applied successfully, except avatar updates which are not available in Direct Messages`,
    },
    import_now: {
      button: `Import Now`,
      imported: `Imported`,
      already_imported_title: `Already Imported`,
      already_imported_description: `This persona has already been imported, or an import is currently in progress.`,
    },
    generate: {
      description: `AI-powered personality generation (requires a compatible provider)`,
      modal: {
        title: `Generate AI Personality`,
        character_name_label: `Character Name`,
        character_name_description: `Comma-separated names ("," or "、"): all become trigger words; first becomes display name.`,
        character_name_placeholder: `e.g. Hatsune Miku, Miku, 初音ミク`,
        character_info_label: `Character Info & Speech Examples`,
        character_info_description: `Describe the character and how they speak`,
        character_info_placeholder: `Personality, backstory, speech style, example phrases, etc.`,
        web_search_label: `Search the Web?`,
        web_search_description: `Search for character info (for existing characters from media)`,
        web_search_placeholder: `Select Yes or No`,
        web_search_yes: `Yes, search for character information`,
        web_search_no: `No, create original character`,
        additional_inst_label: `Additional Instructions`,
        additional_inst_placeholder: `Optional: Other instructions (e.g., "please keep the character's responses short")`,
        file_upload_label: `Character Image / Card (Optional)`,
        file_upload_description: `Upload an image, Tomori preset, or SillyTavern card PNG to generate or transform a character`,
      },
      field_character_name: `Character Name`,
      field_character_info: `Character Info & Speech Examples`,
      field_web_search: `Search the Web?`,
      field_additional_inst: `Additional Instructions`,
      wrong_provider_title: `Incompatible Provider`,
      wrong_provider_description: `Preset generation requires a compatible provider. Your current provider is **{current_provider}**. Use \`/config\` > Models > Switch Models to switch to a supported provider.`,
      no_api_key_title: `No API Key`,
      no_api_key_description: `No active provider is configured. Use \`/setup\` (first time) or \`/providers\` to register one.`,
      model_incompatible_title: `Incompatible Model`,
      model_incompatible_description: `Your current model (**{model_name}**) does not support **STRUCTURED OUTPUT**, which is required for persona generation.

**Next steps:**
Use \`/config\` > Models > Switch Models to switch to a model that supports structured output (e.g., models with "STRUCT" capability).`,
      image_vision_required_title: `Image Vision Required`,
      image_vision_required_description: `You uploaded an image, but your current model (**{model_name}**) does not support **IMAGE VISION** and no vision model is configured.

**Next steps:**
1. Use \`/config\` > Models > Switch Models to set a dedicated vision model, OR
2. Use \`/config\` > Models > Switch Models to switch to a vision-capable model, OR
3. Remove the image and regenerate without it`,
      web_search_tools_required_title: `Web Search Unavailable`,
      web_search_tools_required_description: `You selected web search, but the current model (**{model_name}**) does not support **TOOLS**.

**Next steps:**
1. Use \`/config\` > Models > Switch Models to switch to a tool-enabled model, OR
2. Regenerate without web search (choose "No" when asked)`,
      api_key_decrypt_failed_title: `API Key Error`,
      api_key_decrypt_failed_description: `Failed to decrypt the active provider credentials. Please reconfigure them using \`/providers\`.`,
      vision_credentials_unavailable_title: `Vision Model Credentials Unavailable`,
      vision_credentials_unavailable_description: `Your vision model (**{vision_model_name}**) runs on provider **{vision_provider}**, but its saved API key could not be used to describe the image. Reconfigure that provider's credentials with \`/providers\`, or check \`/config\` > Models.`,
      invalid_image_title: `Invalid Image`,
      invalid_image_description: `Please upload a valid image file (PNG, JPG, JPEG, etc.).`,
      error_file_too_large: `Avatar image must be {max_size}MB or smaller.`,
      error_download_timeout: `Avatar download timed out. Please try again.`,
      error_download_failed: `Failed to download avatar image.`,
      processing_title: `Generating Personality...`,
      processing_description: `This may take 1-2 minutes. Please wait while I generate the character...

This may produce unexpected results. You can regenerate if needed.`,
      captioning_title: `Describing Your Avatar...`,
      captioning_description: `Your primary model cannot see images, so I am asking your vision model (**{model_name}**) to describe the uploaded avatar first. Your primary model then writes the personality from that description. This may take 1-2 minutes.`,
      generation_failed_title: `Generation Failed`,
      generation_failed_description: `Failed to generate personality: {error}

Please try again with different inputs or check your API key.`,
      vision_caption_failed_title: `Avatar Description Failed`,
      vision_caption_failed_description: `Your vision model (**{vision_model_name}** on {vision_provider}) could not describe the uploaded avatar.

**Next steps:**
1. Check that provider's API key with \`/providers\`, OR
2. Remove the image and regenerate, OR
3. Set a different vision model under \`/config\` > Models`,
      validation_failed_title: `Validation Failed`,
      validation_failed_description: `The generated personality data failed validation. Please try again.`,
      image_processing_failed_title: `Image Processing Failed`,
      image_processing_failed_description: `Failed to process the uploaded image. Please try a different image.`,
      avatar_fetch_failed_title: `Avatar Fetch Failed`,
      avatar_fetch_failed_description: `Failed to fetch the server avatar for export. Please try uploading an image instead.`,
      metadata_embed_failed_title: `Export Failed`,
      metadata_embed_failed_description: `Failed to embed personality data in the image. Please try again.`,
      success_title: `{character_name} Generated Successfully!`,
      success_description: `I've generated a persona for **{character_name}**!
**Attributes Preview:**
{attribute_preview}
**Sample Dialogues:**
{dialogue_preview}`,
      success_next_steps_title: `Next Steps`,
      success_next_steps_description: `1. Download the attached PNG file on the right
2. Use \`/persona import\` with the PNG
Or press the Import button`,
      success_next_steps_description_dm: `1. Download the attached PNG file
2. Use \`/persona import\` with the PNG
3. Run \`/refresh\` to apply my new personality`,
      success_next_steps_footer: `You may customize me further under \`/config\` after.`,
      avatar_update_skipped_dm: `Please note that avatar and nickname updates are not available to import in Direct Messages.`,
    },
    create: {
      description: `Create a simple personality preset manually`,
      modal: {
        title: `Create Persona`,
        character_name_label: `Character Name`,
        character_name_description: `Comma-separated names ("," or "、"): all become trigger words; first becomes display name.`,
        character_name_placeholder: `e.g. Hatsune Miku, Miku, 初音ミク`,
        character_desc_label: `Character Description`,
        character_desc_placeholder: `Describe your character (personality, appearance, backstory, etc.)`,
        example_user_label: `Example User Message`,
        example_user_description: `Tip: Add more using /persona sample-dialogue add after`,
        example_user_placeholder: `Hi {bot}!`,
        example_bot_label: `Example Bot Reply`,
        example_bot_placeholder: `Hello {user}! You doing good?`,
        file_upload_label: `Character Image (Optional)`,
        file_upload_description: `Upload an image for the character export`,
      },
      field_character_name: `Character Name`,
      field_character_desc: `Character Description`,
      field_example_user: `Example User Message`,
      field_example_bot: `Example Bot Reply`,
      invalid_image_title: `Invalid Image`,
      invalid_image_description: `Please upload a valid image file (PNG, JPG, JPEG, etc.).`,
      error_file_too_large: `Avatar image must be {max_size}MB or smaller.`,
      error_download_timeout: `Avatar download timed out. Please try again.`,
      error_download_failed: `Failed to download avatar image.`,
      desc_too_long_title: `Description Too Long`,
      desc_too_long_description: `The character description is too long ({current_length} characters). Maximum allowed length is {max_allowed} characters.`,
      example_user_too_long_title: `Example User Message Too Long`,
      example_user_too_long_description: `The example user message is too long ({current_length} characters). Maximum allowed length is {max_allowed} characters.`,
      example_bot_too_long_title: `Example Bot Reply Too Long`,
      example_bot_too_long_description: `The example bot reply is too long ({current_length} characters). Maximum allowed length is {max_allowed} characters.`,
      validation_failed_title: `Validation Failed`,
      validation_failed_description: `The preset data failed validation. Please try again.`,
      image_processing_failed_title: `Image Processing Failed`,
      image_processing_failed_description: `Failed to process the uploaded image. Please try a different image.`,
      avatar_fetch_failed_title: `Avatar Fetch Failed`,
      avatar_fetch_failed_description: `Failed to fetch the server avatar for export. Please try uploading an image instead.`,
      metadata_embed_failed_title: `Export Failed`,
      metadata_embed_failed_description: `Failed to embed personality data in the image. Please try again.`,
      success_title: `{character_name} Created Successfully!`,
      success_description: `**Description:**
{character_description}`,
      success_dialogue_title: `Sample Dialogue`,
      success_next_steps_title: `Next Steps`,
      success_next_steps_description: `1. Download the attached PNG file on the right
2. Use \`/persona import\` with the PNG
Or press the Import button`,
      success_next_steps_footer: `You may customize me further under \`/config\` after.`,
      avatar_update_skipped_dm: `Please note that avatar and nickname updates are not available in Direct Messages.`,
    },
  },
};
