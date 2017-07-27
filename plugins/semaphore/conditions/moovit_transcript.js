let fs = require('fs-extra');
let xml = require('libxmljs');

let parse_xml = function (params) {
    let result = {query: {clip_id: params.clip_id, "info.transcript": {$exists: true}}};
    if (!params.extension.toLowerCase().endsWith('xml')) return result;
    return new Promise(function (resolve, reject) {
        fs.readFile(params.path, function (err, data) {
            if (!err) {
                try {
                    let json = xml.parseXmlString(data).root();
                    let tmp = json.get("//UserField[@Header='Transcription']");

                    if (tmp) {
                        let transcript = tmp.text().trim().toLowerCase();
                        if (transcript === "required") result.update = {"info.transcript": true};
                    }
                    if (!result.hasOwnProperty('update')) result.update = {"info.transcript": false};
                }
                catch (e) {}
            }
            resolve(result);
        });
    });
};

module.exports = parse_xml;
