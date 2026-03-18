import { FiX, FiFolder, FiCheck, FiAlertCircle } from 'react-icons/fi';

export interface DownloadItem {
  id: string;
  fileName: string;
  totalBytes: number;
  receivedBytes: number;
  savePath: string;
  state: 'downloading' | 'completed' | 'cancelled' | 'interrupted';
}

interface Props {
  downloads: DownloadItem[];
  onDismiss: (id: string) => void;
  onShowInFolder: (path: string) => void;
  onDismissAll: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function DownloadBar({ downloads, onDismiss, onShowInFolder, onDismissAll }: Props) {
  if (downloads.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-neutral-100 dark:bg-neutral-800 border-t border-neutral-300 dark:border-neutral-700 overflow-x-auto">
      <span className="text-xs text-neutral-500 dark:text-neutral-400 shrink-0">Downloads</span>
      <div className="flex gap-2 flex-1 min-w-0 overflow-x-auto">
        {downloads.map(dl => (
          <div
            key={dl.id}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white dark:bg-neutral-700 border border-neutral-200 dark:border-neutral-600 text-xs max-w-[250px] shrink-0"
          >
            {dl.state === 'completed' ? (
              <FiCheck size={12} className="text-green-500 shrink-0" />
            ) : dl.state === 'downloading' ? (
              <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
            ) : (
              <FiAlertCircle size={12} className="text-red-400 shrink-0" />
            )}
            <span className="truncate text-neutral-700 dark:text-neutral-200">{dl.fileName}</span>
            {dl.state === 'downloading' && dl.totalBytes > 0 && (
              <span className="text-neutral-400 shrink-0">
                {Math.round((dl.receivedBytes / dl.totalBytes) * 100)}%
              </span>
            )}
            {dl.state === 'downloading' && dl.totalBytes > 0 && (
              <span className="text-neutral-400 shrink-0">
                {formatBytes(dl.receivedBytes)}/{formatBytes(dl.totalBytes)}
              </span>
            )}
            {dl.state === 'completed' && (
              <button
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                title="Show in Finder"
                onClick={() => onShowInFolder(dl.savePath)}
              >
                <FiFolder size={12} />
              </button>
            )}
            <button
              className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 shrink-0"
              onClick={() => onDismiss(dl.id)}
            >
              <FiX size={12} />
            </button>
          </div>
        ))}
      </div>
      <button
        className="text-xs text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 shrink-0"
        onClick={onDismissAll}
      >
        Clear all
      </button>
    </div>
  );
}
