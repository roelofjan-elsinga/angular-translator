import {Extractor} from "./Extractor";
import {compile} from "./Compiler";
import * as fs from 'fs';
import * as glob from 'glob';
import * as path from 'path';

export class AngularTranslator {

    constructor(options) {
        this.compileTranslations = options.compileTranslations;
        this.extractStrings = options.extractStrings;
    }

    apply(compiler) {
        compiler.plugin('emit', (compilation, done) => {

            if (this.compileTranslations) {
                const results = compile(this.compileTranslations);
                results.forEach( (result) => {
                    const { fileName, content } = result;
                    const outPath = path.join(this.compileTranslations.outputFolder, fileName);
                    compilation.assets[outPath] = {
                        source: function() {
                            return content;
                        },
                        size: function() {
                            return content.length;
                        }
                    };
                } );
            }

            if (this.extractStrings) {
                const extractor = new Extractor(this.extractStrings);

                const filePaths = glob.sync(this.extractStrings.input, {
                    follow: true
                });

                filePaths.forEach( (fileName) => {
                    const content = fs.readFileSync(fileName, 'utf8');
                    extractor.parse(fileName, content);
                });

                fs.writeFileSync(this.extractStrings.destination, extractor.toString())
            }

            done();
        });
    }

}