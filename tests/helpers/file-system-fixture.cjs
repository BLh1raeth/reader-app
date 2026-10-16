function createFileSystemMock() {
  const files = new Map();
  const directories = new Set(['file:///docs', 'file:///cache']);
  const uriFor = (parts) => parts.map((part, index) => {
    const value = typeof part === 'string' ? part : part.uri;
    return index === 0 ? value.replace(/\/$/, '') : value.replace(/^\/+|\/+$/g, '');
  }).join('/');

  class Directory {
    constructor(...parts) { this.uri = uriFor(parts); }
    get exists() { return directories.has(this.uri); }
    create() {
      let current = this.uri;
      while (current.startsWith('file:///') && !directories.has(current)) {
        directories.add(current);
        current = current.slice(0, current.lastIndexOf('/'));
      }
    }
    list() {
      const prefix = `${this.uri}/`;
      return [...files.keys()].filter((uri) => uri.startsWith(prefix) && !uri.slice(prefix.length).includes('/'))
        .map((uri) => new File(uri));
    }
    delete() {
      for (const uri of files.keys()) {
        if (uri.startsWith(`${this.uri}/`)) files.delete(uri);
      }
      for (const uri of directories) {
        if (uri === this.uri || uri.startsWith(`${this.uri}/`)) directories.delete(uri);
      }
    }
  }

  class File {
    constructor(...parts) { this.uri = uriFor(parts); }
    get exists() { return files.has(this.uri); }
    get size() { return files.get(this.uri)?.length ?? 0; }
    get name() { return this.uri.split('/').at(-1); }
    create() { files.set(this.uri, new Uint8Array()); }
    async bytes() { return new Uint8Array(files.get(this.uri) ?? []); }
    async copy(destination) { files.set(destination.uri, await this.bytes()); }
    open() {
      let offset = 0;
      const uri = this.uri;
      return {
        get offset() { return offset; }, set offset(value) { offset = value; },
        get size() { return offset === null ? null : files.get(uri)?.length ?? 0; },
        close() { offset = null; },
        readBytes(length) {
          if (offset === null) throw new Error('handle closed');
          const bytes = files.get(uri);
          if (!bytes) throw new Error('file missing');
          const chunk = bytes.slice(offset, offset + length); offset += chunk.length; return chunk;
        },
        writeBytes(bytes) {
          if (offset === null) throw new Error('handle closed');
          const old = files.get(uri) ?? new Uint8Array();
          const next = new Uint8Array(Math.max(old.length, offset + bytes.length));
          next.set(old); next.set(bytes, offset); offset += bytes.length; files.set(uri, next);
        },
      };
    }
    async arrayBuffer() {
      const bytes = files.get(this.uri);
      if (!bytes) throw new Error(`missing file: ${this.uri}`);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
    write(bytes) { files.set(this.uri, new Uint8Array(bytes)); }
    delete() { files.delete(this.uri); }
  }

  return {
    Directory, File,
    Paths: { document: { uri: 'file:///docs' }, cache: { uri: 'file:///cache' } },
    files, directories,
  };
}

module.exports = { createFileSystemMock };
