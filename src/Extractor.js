'use strict';

import * as cheerio from 'cheerio';
import Po from 'pofile';
import * as babylon from 'babylon';
import {parse as tsParse} from '@typescript-eslint/parser';
import search from 'binary-search';
import _ from 'lodash';

const escapeRegex = /[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g;
const noContext = '$$noContext';

function mkAttrRegex(startDelim, endDelim, attribute) {
    let start = startDelim.replace(escapeRegex, '\\$&');
    const end = endDelim.replace(escapeRegex, '\\$&');

    if (start === '' && end === '') {
        start = '^';
    } else {
        // match optional :: (Angular 1.3's bind once syntax) without capturing
        start += '(?:\\s*\\:\\:\\s*)?';
    }

    if (!_.isString(attribute) || attribute.length === 0) {
        attribute = 'translate';
    }

    return new RegExp(start + '\\s*(\'|"|&quot;|&#39;)(.*?)\\1\\s*\\|\\s*' + attribute + '\\s*:?\\s?(?:(\'|"|&quot;|&#39;)\\s*(.*?)\\3)?\\s*(?:' + end + '|\\|)', 'g');
}

function stringCompare(a, b) {
    return a === b ? 0 : a > b ? 1 : -1;
}

function contextCompare(a, b) {
    if (a !== null && b === null) {
        return -1;
    } else if (a === null && b !== null) {
        return 1;
    }
    return stringCompare(a, b);
}

function comments2String(comments) {
    return comments.join(', ');
}

function walkJs(node, fn, parentComment) {
    fn(node, parentComment);

    // Handle ts comments
    if (node && node.comments) {
        parentComment = node;
        parentComment.comments.reverse();
    }

    for (var key in node) {
        var obj = node[key];
        if (node && node.leadingComments) {
            parentComment = node;
        }

        if (typeof obj === 'object') {
            walkJs(obj, fn, parentComment);
        }
    }
}

function isStringLiteral(node) {
    return node.type === 'StringLiteral' || (node.type === 'Literal' && typeof(node.value) === 'string');
}

function getJSExpression(node) {
    var res = '';
    if (isStringLiteral(node)) {
        res = node.value;
    }

    if (node.type === 'TemplateLiteral') {
        node.quasis.forEach(function (elem) {
            res += elem.value.raw;
        });
    }

    if (node.type === 'BinaryExpression' && node.operator === '+') {
        res += getJSExpression(node.left);
        res += getJSExpression(node.right);
    }
    return res;
}

var Extractor = (function () {
    function Extractor(options) {
        this.options = _.extend({
            startDelim: '{{',
            endDelim: '}}',
            markerName: 'gettext',
            markerNames: [],
            moduleName: 'gettextCatalog',
            moduleMethodString: 'getString',
            moduleMethodPlural: 'getPlural',
            attribute: 'translate',
            attributes: [],
            pluralAttribute: 'translate-plural',
            contextAttribute: 'translate-context',
            commentAttribute: 'translate-comment',
            header: true,
            lineNumbers: true,
            extensions: {
                htm: 'html',
                html: 'html',
                php: 'html',
                phtml: 'html',
                tml: 'html',
                ejs: 'html',
                erb: 'html',
                js: 'js',
                tag: 'html',
                jsp: 'html',
                ts: 'js',
                tsx: 'js',
            },
            postProcess: function (po) {}
        }, options);
        this.options.markerNames.unshift(this.options.markerName);
        this.options.attributes.unshift(this.options.attribute);

        this.strings = {};
        this.attrRegex = mkAttrRegex(this.options.startDelim, this.options.endDelim, this.options.attribute);
        this.noDelimRegex = mkAttrRegex('', '', this.options.attribute);
    }

    Extractor.isValidStrategy = function (strategy) {
        return strategy === 'html' || strategy === 'js';
    };

    Extractor.mkAttrRegex = mkAttrRegex;

    Extractor.prototype.addString = function (reference, string, plural, extractedComment, context) {
        // maintain backwards compatibility
        if (_.isString(reference)) {
            reference = { file: reference };
        }

        string = string.replace(/\s+/g, ' ').trim();

        if (string.length === 0) {
            return;
        }

        if (!context) {
            context = noContext;
        }

        if (!this.strings[string]) {
            this.strings[string] = {};
        }

        if (!this.strings[string][context]) {
            this.strings[string][context] = new Po.Item();
        }

        var item = this.strings[string][context];
        item.msgid = string;

        var refString = reference.file;
        if (this.options.lineNumbers && reference.location && reference.location.start) {
            var line = reference.location.start.line;
            if (line || line === 0) {
                refString += ':' + reference.location.start.line;
            }
        }
        var refIndex = search(item.references, refString, stringCompare);
        if (refIndex < 0) { // don't add duplicate references
            // when not found, binary-search returns -(index_where_it_should_be + 1)
            item.references.splice(Math.abs(refIndex + 1), 0, refString);
        }

        if (context !== noContext) {
            item.msgctxt = context;
        }

        if (plural && plural !== '') {
            if (item.msgid_plural && item.msgid_plural !== plural) {
                throw new Error('Incompatible plural definitions for ' + string + ': ' + item.msgid_plural + ' / ' + plural + ' (in: ' + (item.references.join(', ')) + ')');
            }
            item.msgid_plural = plural;
            item.msgstr = ['', ''];
        }
        if (extractedComment) {
            var commentIndex = search(item.extractedComments, extractedComment, stringCompare);
            if (commentIndex < 0) { // don't add duplicate comments
                item.extractedComments.splice(Math.abs(commentIndex + 1), 0, extractedComment);
            }
        }
    };

    Extractor.prototype.extractJs = function (filename, src, lineNumber) {
        // used for line number of JS in HTML <script> tags
        lineNumber = lineNumber || 0;
        const self = this;
        let syntax;
        const extension = filename.split('.').pop();
        try {
            if (extension === 'ts' || extension === 'tsx') {
                syntax = tsParse(src, {
                    sourceType: 'module',
                    comment: true,
                    ecmaFeatures: {
                        jsx: true
                    }
                });
            } else {
                syntax = babylon.parse(src, {
                    sourceType: 'module',
                    plugins: [
                        'jsx',
                        'objectRestSpread',
                        'decorators',
                        'classProperties',
                        'exportExtensions',
                        'functionBind'
                    ]
                });
            }
        } catch (err) {
            console.warn(err);

            var errMsg = 'Error parsing';
            if (filename) {
                errMsg += ' ' + filename;
            }
            if (err.lineNumber) {
                errMsg += ' at line ' + err.lineNumber;
                errMsg += ' column ' + err.column;
            }

            console.warn(errMsg);
            return;
        }

        function isGettext(node) {
            return node !== null &&
                node.type === 'CallExpression' &&
                node.callee !== null &&
                (self.options.markerNames.indexOf(node.callee.name) > -1 || (
                    node.callee.property &&
                    self.options.markerNames.indexOf(node.callee.property.name) > -1
                )) &&
                node.arguments !== null &&
                node.arguments.length;
        }

        function isGetString(node) {
            return node !== null &&
                node.type === 'CallExpression' &&
                node.callee !== null &&
                node.callee.type === 'MemberExpression' &&
                node.callee.object !== null && (
                    node.callee.object.name === self.options.moduleName || (
                        // also allow gettextCatalog calls on objects like this.gettextCatalog.getString()
                    node.callee.object.property &&
                    node.callee.object.property.name === self.options.moduleName)) &&
                node.callee.property !== null &&
                node.callee.property.name === self.options.moduleMethodString &&
                node.arguments !== null &&
                node.arguments.length;
        }

        function isGetPlural(node) {
            return node !== null &&
                node.type === 'CallExpression' &&
                node.callee !== null &&
                node.callee.type === 'MemberExpression' &&
                node.callee.object !== null && (
                    node.callee.object.name === self.options.moduleName || (
                        // also allow gettextCatalog calls on objects like this.gettextCatalog.getPlural()
                    node.callee.object.property &&
                    node.callee.object.property.name === self.options.moduleName)) &&
                node.callee.property !== null &&
                node.callee.property.name === self.options.moduleMethodPlural &&
                node.arguments !== null &&
                node.arguments.length;
        }

        function isTemplateElement(node) {
            return node !== null &&
                node.type === 'TemplateElement' &&
                node.value &&
                node.value.raw;
        }

        walkJs(syntax, function (node, parentComment) {
            var str;
            var context;
            var singular;
            var plural;
            var extractedComments = [];
            var reference = {
                file: filename,
                location: (function () {
                    if (!node || !node.loc || !node.loc.start) {
                        return null;
                    }

                    return {
                        start: {
                            line: node.loc.start.line + lineNumber
                        }
                    };
                })()
            };

            if (isGettext(node) || isGetString(node)) {
                str = getJSExpression(node.arguments[0]);
                if (node.arguments[2]) {
                    context = getJSExpression(node.arguments[2]);
                }
            } else if (isGetPlural(node)) {
                singular = getJSExpression(node.arguments[1]);
                plural = getJSExpression(node.arguments[2]);
                if (node.arguments[4]) {
                    context = getJSExpression(node.arguments[4]);
                }
            } else if (isTemplateElement(node)) {
                var line = reference.location && reference.location.start.line ? reference.location.start.line - 1 : 0;
                self.extractHtml(reference.file, node.value.raw, line);
            }
            if (str || singular) {
                var leadingComments = node.leadingComments || (parentComment ? parentComment.leadingComments : []);
                if (leadingComments) {
                    leadingComments.forEach(function (comment) {
                        if (comment.value.match(/^\/ .*/)) {
                            extractedComments.push(comment.value.replace(/^\/ /, ''));
                        }
                    });
                }

                // Handle ts comments
                if (parentComment.comments) {
                    var commentFound = 0;
                    parentComment.comments.forEach(function (comment) {
                        if (comment.type === 'Line' &&
                            comment.loc.start.line === (reference.location.start.line - commentFound - 1) &&
                            comment.value.match(/^\/ .*/)) {
                            commentFound++;
                            extractedComments.push(comment.value.replace(/^\/ /, ''));
                        }
                    });
                    extractedComments.reverse();
                }

                if (str) {
                    self.addString(reference, str, plural, comments2String(extractedComments), context);
                } else if (singular) {
                    self.addString(reference, singular, plural, comments2String(extractedComments), context);
                }
            }
        });
    };

    Extractor.prototype.extractHtml = function (filename, src, lineNumber) {
        var extractHtml = function (src, lineNumber) {

            var $ = cheerio.load(src, { decodeEntities: false, withStartIndices: true });
            var self = this;

            var newlines = function (index) {
                return src.substr(0, index).match(/\n/g) || [];
            };
            var reference = function (index) {
                return {
                    file: filename,
                    location: {
                        start: {
                            line: lineNumber + newlines(index).length + 1
                        }
                    }
                };
            };

            $('*').each(function (index, n) {
                var node = $(n);

                var getAttr = function (attr) {
                    return node.attr(attr) || node.data(attr);
                };

                var str = node.html();
                var extracted = {};
                var possibleAttributes = self.options.attributes;

                possibleAttributes.forEach(function (attr) {
                    extracted[attr] = {
                        plural: getAttr(attr + '-plural') || getAttr(self.options.pluralAttribute),
                        extractedComment: getAttr(attr + '-comment') || getAttr(self.options.commentAttribute),
                        context: getAttr(attr + '-context') || getAttr(self.options.contextAttribute)
                    };
                });

                if (n.name === 'script') {
                    if (n.attribs.type === 'text/ng-template') {
                        extractHtml(node.text(), newlines(n.startIndex).length);
                        return;
                    }

                    // In HTML5, type defaults to text/javascript.
                    // In HTML4, it's required, so if it's not there, just assume it's JS
                    if (!n.attribs.type || n.attribs.type === 'text/javascript') {
                        self.extractJs(filename, node.text(), newlines(n.startIndex).length);
                        return;
                    }
                }

                if (node.is(self.options.attribute)) {
                    self.addString(reference(n.startIndex), str, extracted[self.options.attribute].plural, extracted[self.options.attribute].extractedComment, extracted[self.options.attribute].context);
                    return;
                }

                for (var attr in node.attr()) {
                    attr = attr.replace(/^data-/, '');

                    if (possibleAttributes.indexOf(attr) > -1) {
                        var attrValue = extracted[attr];
                        str = node.html(); // this shouldn't be necessary, but it is
                        self.addString(reference(n.startIndex), str || getAttr(attr) || '', attrValue.plural, attrValue.extractedComment, attrValue.context);
                    } else if (matches = self.noDelimRegex.exec(getAttr(attr))) {
                        str = matches[2].replace(/\\\'/g, '\'');
                        self.addString(reference(n.startIndex), str);
                        self.noDelimRegex.lastIndex = 0;
                    }
                }
            });

            var matches;
            while (matches = this.attrRegex.exec(src)) {
                var str = matches[2].replace(/\\\'/g, '\'');
                var context = matches[4] ? matches[4].replace(/\\\'/g, '\'') : null;
                this.addString(reference(matches.index), str, null, null, context);
            }
        }.bind(this);

        extractHtml(src, lineNumber || 0);
    };

    Extractor.prototype.isSupportedByStrategy = function (strategy, extension) {
        return (extension in this.options.extensions) && (this.options.extensions[extension] === strategy);
    };

    Extractor.prototype.parse = function (filename, content) {
        var extension = filename.split('.').pop();

        if (this.isSupportedByStrategy('html', extension)) {
            this.extractHtml(filename, content);
        }
        if (this.isSupportedByStrategy('js', extension)) {
            this.extractJs(filename, content);
        }
    };

    Extractor.prototype.toString = function () {
        var catalog = new Po();

        if(this.options.header) {
            catalog.headers = {
                'Content-Type': 'text/plain; charset=UTF-8',
                'Content-Transfer-Encoding': '8bit',
                'Project-Id-Version': ''
            };
        }

        var sortedItems = [];
        for (var msgstr in this.strings) {
            var msg = this.strings[msgstr];
            var contexts = Object.keys(msg);
            for (var i = 0; i < contexts.length; i++) {
                sortedItems.push([msg[contexts[i]], i]);
            }
        }

        sortedItems.sort(function (a, b) {
            return contextCompare(a[0].msgctxt, b[0].msgctxt) || stringCompare(a[0].msgid, b[0].msgid) || (a[1] - b[1]);
        });

        for (var j = 0; j < sortedItems.length; j++) {
            catalog.items.push(sortedItems[j][0]);
        }

        this.options.postProcess(catalog);

        return catalog.toString();
    };

    return Extractor;
})();


module.exports.Extractor = Extractor;