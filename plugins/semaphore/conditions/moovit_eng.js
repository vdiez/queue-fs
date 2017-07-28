let fs = require('fs-extra');
let xml = require('libxmljs');

let parse_xml = function (params) {
    let result = {query: {clip_id: params.clip_id, "info.eng": {$exists: true}}};
    if (!params.extension.toLowerCase().endsWith('xml')) return result;
    return new Promise(function (resolve, reject) {
        fs.readFile(params.path, function (err, data) {
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
