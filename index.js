const Extractor = require('./src/Extractor').Extractor;
const compile = require('./src/Compiler').compile;
const fs = require('fs');
const glob = require("glob");
const path = require('path');

function AngularGetText(options) {
    this.compileTranslations = options.compileTranslations;
    this.extractStrings = options.extractStrings;
}

AngularGetText.prototype.apply = function(compiler) {
    const options = this;

    compiler.plugin('emit', (compilation, done) => {

        if (options.compileTranslations) {
            const results = compile(options.compileTranslations);
            results.forEach( (result) => {
                const { fileName, content } = result;
                const outPath = path.join(options.compileTranslations.outputFolder, fileName);
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

        if (options.extractStrings) {
            var extractor = new Extractor(options.extractStrings);

            const filePaths = glob.sync(options.extractStrings.input)
            filePaths.forEach( (fileName) => {
                var content = fs.readFileSync(fileName, 'utf8');
                extractor.parse(fileName, content);
            });
            fs.writeFileSync(options.extractStrings.destination, extractor.toString())
        }

        done();
    });
};

module.exports.AngularGetText = AngularGetText;