'use strict';

import * as fs from 'fs';
import * as glob from 'glob';
import * as path from 'path';
import * as Po from 'pofile';
import _ from 'lodash';

const formats = {
    json: {
        addLocale: function (locale, strings) {
            return {
                name: locale,
                strings: strings
            };
        },
        format: function (locales, options) {
            let result = {};
            locales.forEach(function (locale) {
                if (!result[locale.name]) {
                    result[locale.name] = {};
                }
                _.assign(result[locale.name], locale.strings);
            });
            return JSON.stringify(result);
        }
    }
};

const noContext = '$$noContext';

const Compiler = (function () {
    function Compiler(options) {
        this.options = _.extend({
            format: 'json',
            module: 'gettext'
        }, options);
    }

    Compiler.browserConvertedHTMLEntities = {
        'hellip': '…',
        'cent': '¢',
        'pound': '£',
        'euro': '€',
        'laquo': '«',
        'raquo': '»',
        'rsaquo': '›',
        'lsaquo': '‹',
        'copy': '©',
        'reg': '®',
        'trade': '™',
        'sect': '§',
        'deg': '°',
        'plusmn': '±',
        'para': '¶',
        'middot': '·',
        'ndash': '–',
        'mdash': '—',
        'lsquo': '‘',
        'rsquo': '’',
        'sbquo': '‚',
        'ldquo': '“',
        'rdquo': '”',
        'bdquo': '„',
        'dagger': '†',
        'Dagger': '‡',
        'bull': '•',
        'prime': '′',
        'Prime': '″',
        'asymp': '≈',
        'ne': '≠',
        'le': '≤',
        'ge': '≥',
        'sup2': '²',
        'sup3': '³',
        'frac12': '½',
        'frac14': '¼',
        'frac13': '⅓',
        'frac34': '¾'
    };

    Compiler.hasFormat = function (format) {
        return formats.hasOwnProperty(format);
    };

    Compiler.prototype.convertPo = function (inputs) {
        const format = formats[this.options.format];
        let locales = [];

        inputs.forEach(function (input) {
            let catalog = Po.parse(input);

            if (!catalog.headers.Language) {
                throw new Error('No Language header found!');
            }

            let strings = {};
            for (let i = 0; i < catalog.items.length; i++) {
                let item  = catalog.items[i];
                let ctx   = item.msgctxt || noContext;
                let msgid = item.msgid;

                let convertedEntity;
                let unconvertedEntity;
                let unconvertedEntityPattern;

                for ( unconvertedEntity in Compiler.browserConvertedHTMLEntities ) {
                    convertedEntity = Compiler.browserConvertedHTMLEntities[ unconvertedEntity ];
                    unconvertedEntityPattern = new RegExp( '&' + unconvertedEntity + ';?', 'g' );
                    msgid = msgid.replace( unconvertedEntityPattern, convertedEntity );
                }

                if (item.msgstr[0].length > 0 && !item.flags.fuzzy && !item.obsolete) {
                    if (!strings[msgid]) {
                        strings[msgid] = {};
                    }

                    // Add array for plural, single string for signular.
                    strings[msgid][ctx] = item.msgstr.length === 1 ? item.msgstr[0] : item.msgstr;
                }
            }

            // Strip context from strings that have no context.
            for (let key in strings) {
                if (Object.keys(strings[key]).length === 1 && strings[key][noContext]) {
                    strings[key] = strings[key][noContext];
                }
            }

            locales.push(format.addLocale(catalog.headers.Language, strings));
        });

        return format.format(locales, this.options);
    };

    return Compiler;
})();

export function compile(options) {
    // https://github.com/rubenv/grunt-angular-gettext/blob/master/tasks/compile.js#L7
    if (!Compiler.hasFormat(options.format)) {
        throw new Error('There is no "' + options.format + '" output format.');
    }

    const compiler = new Compiler({
        format: options.format
    });

    const filePaths = glob.sync(options.input);
    return filePaths.map( (filePath) => {
        const content = fs.readFileSync(filePath, options.encoding || 'utf-8');
        const fullFileName = path.basename(filePath);
        return {
            content: compiler.convertPo([content]),
            fileName: path.basename(filePath, path.extname(fullFileName)) + '.' + options.format
        };
    } );
}
