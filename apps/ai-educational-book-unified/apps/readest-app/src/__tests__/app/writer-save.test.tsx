import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { saveDialog, writeTextFile } = vi.hoisted(() => ({
  saveDialog: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => true,
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: saveDialog }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeTextFile }));

import WriterPage from '@/app/writer/page';

describe('writer file save', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    window.localStorage.clear();
    saveDialog.mockReset();
    saveDialog.mockResolvedValue('C:/Books/Study Notes.md');
    writeTextFile.mockReset();
    writeTextFile.mockResolvedValue(undefined);
  });

  it('uses Ctrl+S to choose a Markdown path once, then update that same file', async () => {
    render(<WriterPage />);

    fireEvent.change(screen.getByLabelText('책 제목'), { target: { value: 'Study Notes' } });
    fireEvent.change(screen.getByLabelText('책 본문'), {
      target: { value: 'First chapter\n\n## A heading' },
    });

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    await waitFor(() =>
      expect(writeTextFile).toHaveBeenCalledWith(
        'C:/Books/Study Notes.md',
        '# Study Notes\n\nFirst chapter\n\n## A heading',
      ),
    );
    expect(saveDialog).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('책 본문'), {
      target: { value: 'Revised chapter' },
    });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    await waitFor(() =>
      expect(writeTextFile).toHaveBeenLastCalledWith(
        'C:/Books/Study Notes.md',
        '# Study Notes\n\nRevised chapter',
      ),
    );
    expect(saveDialog).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem('ai-educational-book.writer.v1') ?? '{}',
      ) as { filePath?: string; fileDirty?: boolean };
      expect(stored.filePath).toBe('C:/Books/Study Notes.md');
      expect(stored.fileDirty).toBe(false);
    });
  });

  it('keeps the recovery draft when the first-save dialog is cancelled', async () => {
    saveDialog.mockResolvedValueOnce(null);
    render(<WriterPage />);

    fireEvent.change(screen.getByLabelText('책 본문'), { target: { value: 'Keep this draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ctrl+S 저장' }));

    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem('ai-educational-book.writer.v1') ?? '{}',
      ) as { body?: string };
      expect(stored.body).toBe('Keep this draft');
    });
    expect(writeTextFile).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('파일 저장 필요');
  });

  it('keeps the recovery draft and reports a file-write failure', async () => {
    writeTextFile.mockRejectedValueOnce(new Error('permission denied'));
    render(<WriterPage />);

    fireEvent.change(screen.getByLabelText('책 본문'), { target: { value: 'Recover this draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ctrl+S 저장' }));

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('파일 저장 오류'));
    const stored = JSON.parse(
      window.localStorage.getItem('ai-educational-book.writer.v1') ?? '{}',
    ) as { body?: string; fileDirty?: boolean };
    expect(stored.body).toBe('Recover this draft');
    expect(stored.fileDirty).toBe(true);
  });
});
