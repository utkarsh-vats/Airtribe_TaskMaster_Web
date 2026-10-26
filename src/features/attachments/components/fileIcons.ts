import {
    File,
    FileArchive,
    FileImage,
    FileSpreadsheet,
    FileText,
    type LucideIcon,
} from 'lucide-react';

import type { FileKind } from '../fileKind';

/** The icon for each kind of file (rows and the preview's "no preview" state). */
export const FILE_ICONS: Record<FileKind, LucideIcon> = {
    image: FileImage,
    spreadsheet: FileSpreadsheet,
    archive: FileArchive,
    document: FileText,
    other: File,
};
