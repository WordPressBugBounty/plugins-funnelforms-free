/**
 * Step fields that a URL parameter can fill (`props.prefillFromQuery`): text as it is, a number
 * when it reads as one, choices and dropdowns by option id, value or label (several separated by
 * commas where more than one may be chosen).
 */
export const PREFILL_STEP_TYPES = [ 'text', 'textarea', 'email', 'phone', 'url', 'number', 'choice', 'dropdown' ] as const;

/**
 * Contact fields that a URL parameter can fill: text as it is, the salutation by herr, frau,
 * divers, firma (as 3.x) or its id, a list by option id or label, a checkbox by 1, true, yes, ja.
 */
export const PREFILL_CONTACT_TYPES = [ 'salutation', 'name', 'email', 'phone', 'text', 'textarea', 'select', 'checkbox' ] as const;

/** URL parameter names a field can be filled from. */
export const PREFILL_PARAM = /^[A-Za-z0-9_.-]{1,64}$/;
