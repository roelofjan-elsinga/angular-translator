# Angular Translator

This is a version of angular-translate for AngularJS ported to Angular. 
This package can be used to extract strings from Angular templates and place them in .po files, just like angular-gettext. 
This is ported for usage in Angular, instead of AngularJS.

## Usage in Webpack

```JavaScript
plugins: [
    new AngularGetTextPlugin({
        compileTranslations: { //optional
            input: 'path/to/files/*.po',
            outputFolder: 'path/to/output',
            format: 'json' // or javascript
        },
        extractStrings: { //optional
            input: 'path/to/files/**/*.html',
            destination: 'path/to/strings/file/translations.pot',
            pluralAttribute: 'translateplural',
            contextAttribute: 'translatecontext',
            commentAttribute: 'translatecomment',
            attributes: ['translate', 'apptranslate']
        }
    }),
]
```