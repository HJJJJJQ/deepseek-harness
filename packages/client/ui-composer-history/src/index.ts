/**
 * Composer prompt-history plugin, node half. Pure browser surface: the empty
 * apply exists so the plugin can appear in the host cordis tree; the browser
 * half ships through exports["./client"] and the dsh.client declaration.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
