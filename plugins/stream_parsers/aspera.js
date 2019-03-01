module.exports = {
    parse(data, stderr) {
        if (data instanceof Buffer) {
            data = data.toString('utf8');
            if (stderr) this.data.stderr += data;
            else this.data.stderr += data;
        }
        let match_progress = data.match(/(\d+)%\s+(\w+)/);
        if (match_progress) {
            this.data.current = match_progress[2];
            if (this.data.current.toLowerCase().endsWith('kb')) this.data.current = Number(this.data.current.slice(0,-2)) * 1024;
            else if (this.data.current.toLowerCase().endsWith('mb')) this.data.current = Number(this.data.current.slice(0,-2)) * 1024 * 1024;
            else if (this.data.current.toLowerCase().endsWith('gb')) this.data.current = Number(this.data.current.slice(0,-2)) * 1024 * 1024 * 1024;
            if (Number(match_progress[1]) !== this.data.percentage) {
                this.data.percentage = Number(match_progress[1]);
                if (this.publish) this.publish(this.data);
            }
        }
    }
};