import { lstat, open, readdir } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { auditTopicWriterTree } from '../../tools/lib/topic-writer-audit.ts';

vi.mock('node:fs/promises', () => ({ lstat: vi.fn(), open: vi.fn(), readdir: vi.fn() }));
const source = 'db.query("UPDATE posts SET title=?")';
const file = (size = Buffer.byteLength(source), symlink = false) => ({
  size,
  dev: 1,
  ino: 2,
  mtimeMs: 3,
  isSymbolicLink: () => symlink,
  isDirectory: () => false,
  isFile: () => true,
});
const directory = { isSymbolicLink: () => false, isDirectory: () => true };
let text: string, fd: { stat: ReturnType<typeof vi.fn>; read: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
describe('source audit must not pass partial scans', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(readdir).mockImplementation(async (path) => (String(path).endsWith('/app/src') ? ['writer.ts'] : []) as never);
    vi.mocked(lstat).mockImplementation(
      async (p) => (String(p).endsWith('/app/src') || String(p).endsWith('/tools') ? directory : file()) as never,
    );
    text = source;
    fd = {
      stat: vi.fn(async () => file(Buffer.byteLength(text))),
      read: vi.fn(async (buffer: Buffer) => ({ bytesRead: buffer.write(text) })),
      close: vi.fn(),
    };
    vi.mocked(open).mockResolvedValue(fd as never);
  });
  it('refuses symlink source rather than following it outside the audited tree', async () => {
    vi.mocked(lstat).mockImplementation(async (p) => (String(p).endsWith('/writer.ts') ? file(20, true) : directory) as never);
    await expect(auditTopicWriterTree('/repo')).rejects.toThrow('writer-audit-symlink');
    expect(open).not.toHaveBeenCalled();
  });
  it('rejects an oversized file before reading or returning partial enrollment', async () => {
    vi.mocked(lstat).mockImplementation(async (p) => (String(p).endsWith('/writer.ts') ? file(1024 * 1024 + 1) : directory) as never);
    await expect(auditTopicWriterTree('/repo')).rejects.toThrow('writer-audit-byte-cap');
    expect(open).not.toHaveBeenCalled();
  });
  it('rejects an excessive tree instead of silently scanning only the first entries', async () => {
    vi.mocked(readdir).mockResolvedValue(Array.from({ length: 8193 }, (_, i) => `writer-${i}.ts`) as never);
    await expect(auditTopicWriterTree('/repo')).rejects.toThrow('writer-audit-entry-cap');
    expect(open).not.toHaveBeenCalled();
  });
  it('propagates unavailable source and malformed syntax instead of approving a shorter registry', async () => {
    vi.mocked(open).mockRejectedValueOnce(Error('fixture-unavailable'));
    await expect(auditTopicWriterTree('/repo')).rejects.toThrow('fixture-unavailable');
    text = 'db.query(';
    vi.mocked(lstat).mockImplementation(
      async (p) => (String(p).endsWith('/writer.ts') ? file(Buffer.byteLength(text)) : directory) as never,
    );
    await expect(auditTopicWriterTree('/repo')).rejects.toThrow('writer-audit-parse');
    expect(fd.close).toHaveBeenCalledOnce();
  });
  it('rejects a late symlink and a changed descriptor before parsing any bytes', async () => {
    let reads = 0;
    vi.mocked(lstat).mockImplementation(
      async (p) => (String(p).endsWith('/writer.ts') ? file(undefined, ++reads > 1) : directory) as never,
    );
    await expect(auditTopicWriterTree('/repo')).rejects.toThrow('writer-audit-source-type');
    expect(open).not.toHaveBeenCalled();
    vi.mocked(lstat).mockImplementation(async (p) => (String(p).endsWith('/writer.ts') ? file() : directory) as never);
    fd.stat.mockResolvedValue({ ...file(), ino: 999 });
    await expect(auditTopicWriterTree('/repo')).rejects.toThrow('writer-audit-source-changed');
    expect(fd.read).not.toHaveBeenCalled();
    expect(fd.close).toHaveBeenCalledOnce();
  });
  it('rejects symlink root and file growth while retaining the owned descriptor cleanup', async () => {
    vi.mocked(lstat).mockResolvedValue(file(20, true) as never);
    await expect(auditTopicWriterTree('/repo')).rejects.toThrow('writer-audit-directory');
    vi.mocked(lstat).mockImplementation(async (p) => (String(p).endsWith('/writer.ts') ? file() : directory) as never);
    fd.stat.mockResolvedValueOnce(file()).mockResolvedValueOnce(file(1024 * 1024 + 1));
    await expect(auditTopicWriterTree('/repo')).rejects.toThrow('writer-audit-source-changed');
    expect(fd.close).toHaveBeenCalledOnce();
  });
});
