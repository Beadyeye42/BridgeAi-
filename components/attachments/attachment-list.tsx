import Image from "next/image";
import { Download, FileImage, FileText, ShieldCheck } from "lucide-react";
import { SanitizeAttachmentButton } from "@/components/admin/admin-actions";

type AttachmentItem = {
  id: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  scanStatus: string;
};

function fileSize(bytes: number) {
  return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

export function AttachmentList({ files, emptyMessage, canSanitizeImages = false }: { files: AttachmentItem[]; emptyMessage: string; canSanitizeImages?: boolean }) {
  if (!files.length) return <div className="empty-state">{emptyMessage}</div>;

  return files.map((file) => {
    const isImage = file.mimeType === "image/jpeg" || file.mimeType === "image/png";
    if (file.scanStatus !== "CLEAN") {
      return <div className="attachment-file locked" key={file.id}>
        <ShieldCheck size={18}/>
        <div><b>{file.fileName}</b><small>Security check: {file.scanStatus.toLowerCase()}</small></div>
        {canSanitizeImages && file.scanStatus === "PENDING" && isImage && <SanitizeAttachmentButton id={file.id}/>}
      </div>;
    }

    if (isImage) {
      return <article className="attachment-preview" key={file.id}>
        <a
          className="attachment-preview-image"
          href={`/api/attachments/${file.id}/download?preview=1`}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${file.fileName}`}
        >
          <Image
            src={`/api/attachments/${file.id}/download?preview=1`}
            alt={`Customer attachment: ${file.fileName}`}
            width={640}
            height={400}
            sizes="(max-width: 760px) 100vw, 420px"
            unoptimized
          />
        </a>
        <div className="attachment-preview-meta">
          <span><FileImage size={17}/></span>
          <div><b>{file.fileName}</b><small>{file.mimeType} · {fileSize(file.byteSize)}</small></div>
          <a href={`/api/attachments/${file.id}/download`} aria-label={`Download ${file.fileName}`}><Download size={16}/></a>
        </div>
      </article>;
    }

    return <a className="attachment-file" href={`/api/attachments/${file.id}/download`} key={file.id}>
      <span><FileText size={19}/></span>
      <div><b>{file.fileName}</b><small>{file.mimeType} · {fileSize(file.byteSize)}</small></div>
      <Download size={16}/>
    </a>;
  });
}
