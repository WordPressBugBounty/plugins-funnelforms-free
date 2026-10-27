/**
 * Goals and industries of the form templates, in the order of the gallery. The one list the
 * template builder (tools/templates), the gallery (ui/NewForm.tsx) and the plugin
 * (Application\FormTemplates::GOALS and CATEGORIES) go by; test/template-taxonomy.test.ts checks
 * that the plugin's lists and the gallery's labels match it. No imports: tools/templates reads it
 * with Node's type stripping.
 */

/** What a form made from a template is for. */
export const TEMPLATE_GOALS = [ 'quote', 'calculator', 'consultation', 'booking', 'application', 'quiz', 'registration', 'feedback', 'leadmagnet' ] as const;

/** Industries, most asked-for lead businesses in German-speaking countries first; `general` fits every business. */
export const TEMPLATE_CATEGORIES = [ 'craft', 'energy', 'realestate', 'finance', 'hr', 'health', 'legal', 'home', 'auto', 'beauty', 'education', 'coaching', 'b2b', 'agency', 'events', 'ecommerce', 'general' ] as const;
