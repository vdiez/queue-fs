module.exports = {
    parser(data) {
        let match_timecode = data.match(/\W*timecode\s*:\s*(\d+:\d+:\d+:\d+)/);
        if (match_timecode) this.data.timecode = match_timecode[1];
        let match_duration = data.match(/\W*Duration:\s*(\d+:\d+:\d+\.\d+)/);
        if (match_duration) this.data.duration = match_duration[1];
        let fps = data.match(/.*Video.*,\s*([^,]+)\s+fp/)
        if (fps) this.data.fps = fps[1];
    }
};