# Plume statistics: full suite

These numbers compare Plume with Windows Notepad on the same PC, with the same files. The README shows only the headline numbers. Everything else is here.

## Method

- Plume: the installed 0.5.3 release (`Plume-0.5.3-win-x64-setup.exe`), run from its install folder.
- Notepad: `notepad.exe` from Windows.
- Each test ran 3 times per app. The table shows the mean, and the raw runs are in `benchmarks/results.json`.
- "Window ready" is the time from starting the process until the app has a visible window. It does not wait for the document to finish rendering.
- Memory is the sum of the working set of every process the app started, sampled after a 4 second settle.
- Idle CPU is the CPU used over 3 seconds after the settle, as a percent of one core, summed over the app's processes.
- The 50 MB log is generated: lines of the same text, one per record, about 541,000 lines.

## Window ready time (ms, lower is better)

| Test | Plume | Notepad |
| --- | ---: | ---: |
| Startup (no file) | 925 ms | 306 ms |
| Open a small text file | 871 ms | 362 ms |
| Open a 50 MB log file | 1012 ms | 351 ms |

## Memory (MB, lower is better)

| Test | Plume | Notepad |
| --- | ---: | ---: |
| Startup (no file) | 370 MB | 236 MB |
| Open a small text file | 374 MB | 241 MB |
| Open a 50 MB log file | 1866 MB | 261 MB |

## Idle CPU (average over all runs)

Plume 4.3% of one core, Notepad 13%. Both are measured after the window appears, so the start-up work is in the window-ready and memory numbers instead.

## Install size

Plume installed folder: 679 MB (79 files, the Electron runtime and the app). Notepad is part of Windows: its program file is 0.35 MB, and its package size cannot be measured without administrator rights, so no total is shown.

## Raw runs

| App | Test | Run | Window ready (ms) | Memory (MB) | Idle CPU (%) |
| --- | --- | ---: | ---: | ---: | ---: |
| Plume | Startup (no file) | 1 | 986 | 369 | 1.6 |
| Plume | Startup (no file) | 2 | 923 | 372 | 4.2 |
| Plume | Startup (no file) | 3 | 865 | 370 | 10.4 |
| Plume | Open a small text file | 1 | 896 | 372 | 2.1 |
| Plume | Open a small text file | 2 | 870 | 376 | 3.1 |
| Plume | Open a small text file | 3 | 847 | 373 | 2.1 |
| Plume | Open a 50 MB log file | 1 | 1019 | 1873 | 14.6 |
| Plume | Open a 50 MB log file | 2 | 1018 | 1857 | 0.5 |
| Plume | Open a 50 MB log file | 3 | 1000 | 1869 | 0 |
| Notepad | Startup (no file) | 1 | 181 | 236 | 13.5 |
| Notepad | Startup (no file) | 2 | 376 | 242 | 34.9 |
| Notepad | Startup (no file) | 3 | 362 | 229 | 45.3 |
| Notepad | Open a small text file | 1 | 357 | 242 | 0 |
| Notepad | Open a small text file | 2 | 376 | 241 | 0 |
| Notepad | Open a small text file | 3 | 353 | 241 | 2.1 |
| Notepad | Open a 50 MB log file | 1 | 361 | 261 | 7.8 |
| Notepad | Open a 50 MB log file | 2 | 340 | 262 | 4.7 |
| Notepad | Open a 50 MB log file | 3 | 352 | 261 | 8.3 |

## What Plume does that Notepad does not

Notepad is a plain text editor, and it is very good at that. Plume is for more kinds of file in one window: Markdown rendered as you write, a grid for CSV and Excel, a level view for logs, a PDF viewer with page keys and editing, a Word viewer, folder search, and themes. These are features, not speed, and they are not measured here.
