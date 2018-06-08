module.exports = {
    parse(data) {
        if (data instanceof Buffer) data = data.toString('utf8');
        let match_timecode = data.match(/\W*timecode\s*:\s*(\d+:\d+:\d+:\d+)/);
        if (match_timecode) this.data.timecode = match_timecode[1];
        let match_duration = data.match(/\W*Duration:\s*(\d+:\d+:\d+\.\d+)/);
        if (match_duration) this.data.duration = match_duration[1];
    }
};