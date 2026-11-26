'use strict';

const fs = require('node:fs/promises');
const {StringDecoder} = require('node:string_decoder');

const blockSize = 128 * 1024, catchUpLimit = 2 * 1024 * 1024;

function encoding(buffer) {
  return buffer[0] === 0xff && buffer[1] === 0xfe ? 'utf16le' : 'utf8';
}

/** Follow only the ordinary file selected by the user. Readers never start a terminal or a target. */
class FirmwareLog {
  constructor(send, fail) {
    this.send = send;
    this.fail = fail;
    this.generation = 0;
  }

  async start(file, interval = 350) {
    this.stop();
    this.file = file;
    const current = this.generation;
    const tick = async () => {
      if (this.generation !== current) return;
      try {await this.poll(current);}
      catch (error) {
        if (current !== this.generation) return;
        if (error.code !== 'ENOENT') {this.stop();this.fail(error);return;}
      }
      if (interval && this.generation === current) this.timer = setTimeout(tick,interval);
    };
    await tick();
  }

  async poll(current = this.generation) {
    if (!this.file) return;
    const file = await fs.open(this.file,'r');
    try {
      const stat = await file.stat({bigint:true});
      if (!stat.isFile()) throw Error('A regular log file is required.');
      const identity = stat.dev + '/' + stat.ino;
      const size = Number(stat.size);
      if (current !== this.generation) return;
      const reset = this.identity !== identity || size < this.offset ||
        (size === this.offset && this.modified !== stat.mtimeNs && this.offset > 0);
      if (reset) {
        this.offset = 0;
        this.identity = identity;
        this.decoder = undefined;
      }
      if (!this.decoder && size < 2) {
        if (reset) await this.send('',{reset:true,gap:false});
        return;
      }
      if (!this.decoder) {
        const first = Buffer.alloc(2);
        await file.read(first,0,2,0);
        if (current !== this.generation) return;
        this.encoding = encoding(first);
        this.decoder = new StringDecoder(this.encoding);
      }
      this.modified = stat.mtimeNs;
      const gap = size - this.offset > catchUpLimit;
      if (gap) {
        this.offset = size - catchUpLimit;
        if (this.encoding === 'utf16le') this.offset -= this.offset % 2;
        this.decoder = new StringDecoder(this.encoding);
      }
      const bytes = Buffer.alloc(Math.min(blockSize,size-this.offset));
      const {bytesRead} = bytes.length ? await file.read(bytes,0,bytes.length,this.offset) : {bytesRead:0};
      if (current !== this.generation) return;
      this.offset += bytesRead;
      if (bytesRead || reset || gap) await this.send(this.decoder.write(bytes.subarray(0,bytesRead)),{reset,gap});
    } finally {await file.close();}
  }

  stop() {
    this.generation++;
    clearTimeout(this.timer);
    this.file = this.identity = this.decoder = undefined;
    this.offset = 0;
  }
}

module.exports = {FirmwareLog, encoding};
