'use strict';

const Extractor = require("./Extractor");
const fs = require('fs');
const glob = require("glob");
const path = require("path");
const po = require('pofile');
const _ = require('lodash');

const formats = {
    javascript: {
        addLocale: function (locale, strings) {
            return '    gettextCatalog.setStrings(\'' + locale + '\', ' + JSON.stringify(strings) + ');\n';
        },
        format: function (locales, options) {
            let angular = 'angular';
            if (options.browserify) {
                angular = 'require(\'angular\')';
            }
            let module = angular + '.module(\'' + options.module + '\')' +
                '.run([\'gettextCatalog\', function (gettextCatalog) {\n' +
                '/* jshint -W100 */\n' +
                locales.join('') +
                '/* jshint +W100 */\n';
            if (options.defaultLanguage) {
                module += 'gettextCatalog.currentLanguage = \'' + options.defaultLanguage + '\';\n';
            }
            module += '}]);';

            if (options.requirejs) {
                return 'define([\'angular\', \'' + options.modulePath + '\'], function (angular) {\n' + module + '\n});';
            }

            return module;
        }
    },
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
            format: 'javascript',
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
            let catalog = po.parse(input);

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



module.exports.compile = function compile(options) {
    // https://github.com/rubenv/grunt-angular-gettext/blob/master/tasks/compile.js#L7
    if (!Compiler.hasFormat(options.format)) {
        throw new Error('There is no "' + options.format + '" output format.');
    }

    const compiler = new Compiler({
        format: options.format
    });

    const filePaths = glob.sync(options.input)
    const outputs = filePaths.map( (filePath) => {
        const content = fs.readFileSync(filePath, options.encoding || 'utf-8');
        const fullFileName = path.basename(filePath);
        return {
            content: compiler.convertPo([content]),
            fileName: path.basename(filePath, path.extname(fullFileName)) + '.' + options.format
        };
    } );

    return outputs;
};
