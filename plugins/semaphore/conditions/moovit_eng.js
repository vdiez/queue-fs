let fs = require('fs-extra');
let xml = require('libxmljs');

let parse_xml = function (file) {
    let result = {query: {clip_id: file.clip_id, "info.eng": {$exists: true}}};
    if (!file.extension.toLowerCase().endsWith('xml')) return result;
    return new Promise(function (resolve, reject) {
        fs.readFile(file.path, function (err, data) {
            if (!err) {
                try {
                    let json = xml.parseXmlString(data).root();
                    let tmp = json.get("//UserField[@Header='ENG crew']");

                    if (tmp) {
                        let eng = tmp.text().trim().toLowerCase();
                        if (eng) result.update = {info: {eng: eng}};
                    }
                }
                catch (e) {}
            }
            resolve(result);
        });
    });
};

module.exports = parse_xml;
