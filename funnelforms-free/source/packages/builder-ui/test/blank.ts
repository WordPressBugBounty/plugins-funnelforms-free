import type { FormDocument } from '@funnelforms/form-schema';

/** The document of a new form, as BlankDocument in the plugin creates it. */
export function blank(): FormDocument {
	return structuredClone( BLANK );
}

const BLANK: FormDocument = {
	"schemaVersion": 1,
	"id": "frm_1",
	"title": "Anfrage",
	"locales": {
		"default": "de_DE",
		"available": [
			"de_DE"
		]
	},
	"start": "contact",
	"nodes": [
		{
			"id": "contact",
			"type": "contact",
			"title": {
				"de_DE": "Deine Kontaktdaten"
			},
			"description": {
				"de_DE": ""
			},
			"submitLabel": {
				"de_DE": "Absenden"
			},
			"fields": [
				{
					"id": "c_name",
					"type": "name",
					"key": "name",
					"label": {
						"de_DE": "Name"
					},
					"required": true,
					"props": {
						"placeholder": {
							"de_DE": ""
						}
					}
				},
				{
					"id": "c_email",
					"type": "email",
					"key": "email",
					"label": {
						"de_DE": "E-Mail-Adresse"
					},
					"required": true,
					"props": {
						"b2bOnly": false,
						"placeholder": {
							"de_DE": ""
						}
					}
				}
			],
			"showBottomBar": true
		},
		{
			"id": "end",
			"type": "end",
			"success": {
				"show": true,
				"text": {
					"de_DE": "Danke!"
				}
			},
			"redirect": null
		}
	],
	"edges": [
		{
			"id": "e_contact_end",
			"from": "contact",
			"to": "end",
			"default": true
		}
	],
	"calculations": [],
	"actions": [],
	"style": {
		"preset": "default",
		"tokens": {}
	},
	"settings": {
		"uiLocale": "",
		"progressBar": {
			"show": true
		},
		"loadingAnimation": false,
		"scrollToTop": {
			"desktop": false,
			"mobile": true
		},
		"rtl": false,
		"autoHeight": false,
		"iconFont": false,
		"savePartialEntries": false
	},
	"layout": {
		"nodes": {
			"contact": {
				"x": 0,
				"y": 0
			},
			"end": {
				"x": 320,
				"y": 0
			}
		}
	}
};
