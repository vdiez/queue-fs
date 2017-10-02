let fs = require('fs-extra');
let xml = require('libxmljs');

let parse_xml = function (file) {
    let result = {query: {clip_id: file.clip_id, "fields.type": {$exists: true}}};
    if (!file.extension.toLowerCase().endsWith('xml')) return result;
    return new Promise(function (resolve, reject) {
        fs.readFile(file.path, function (err, data) {
            if (!err) {
                try {
                    let content_type = false;
                    let json = xml.parseXmlString(data).root();
                    let tmp = json.get("//UserField[@Header='Competition']") || json.get("//UserField[@Header='Content Type']") || json.get("//UserField[@Header='le_serie_title']");

                    if (tmp) {
                        content_type = tmp.text().trim().toLowerCase();
                        if (content_type.includes("women")) content_type = "uwc";
                        else if (content_type.includes("magazine")) content_type = "magazine";
                        else if (content_type.includes("matchnight")) content_type = "highlights";
                        else if (content_type.includes("match")) content_type = "postmatch";
                        else if (content_type.includes("exchange")) content_type = "newsexchange";
                        else if (content_type.includes("champions league")) content_type = "ucl";
                        else content_type = "other";
                    }
                    if (content_type) result.update = {fields: {type: content_type}};
                }
                catch (e) {}
            }
            resolve(result);
        });
    });
};

module.exports = parse_xml;