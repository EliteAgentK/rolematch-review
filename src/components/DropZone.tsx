import React, { useRef, useState } from "react";
import {
  Box,
  Flex,
  Text,
} from "@chakra-ui/react";
import { useColorModeValue } from "../theme/color-mode";
import { IconButton } from "./ui/icon-button";
import { Button } from "./ui/button";
import { keyframes } from "@emotion/react";
import { FiFile, FiFolder, FiLayers, FiUpload, FiX } from "react-icons/fi";
import { useSettings } from "../settings/SettingsContext";

interface DropZoneProps {
  onFileUpload: (file: File) => void;
  /** Several files, or a whole folder (dropped or chosen). When given, the zone accepts them; without it only one file is taken. */
  onFilesUpload?: (files: File[]) => void;
  label: string;
  /** The server's upload-mode lock is on for this person and kind: say why, link to the batch, and take nothing. */
  locked?: { message: string; onViewBatch?: () => void };
}

/** Every file inside a dropped folder, however deeply nested (the browser hands directories over in chunks of up to 100). */
async function filesOf(entry: any): Promise<File[]> {
  if (entry.isFile) return [await new Promise<File>((res, rej) => entry.file(res, rej))];
  const out: File[] = [], reader = entry.createReader();
  for (;;) {
    const chunk: any[] = await new Promise((res, rej) => reader.readEntries(res, rej));
    if (!chunk.length) break;
    for (const e of chunk) out.push(...(await filesOf(e)));
  }
  return out;
}

const breathe = keyframes`0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); }`;

const DropZone: React.FC<DropZoneProps> = ({ onFileUpload, onFilesUpload, label, locked }) => {
  const { formats } = useSettings();
  const singleRef = useRef<HTMLInputElement | null>(null);
  const multiRef = useRef<HTMLInputElement | null>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);
  const [step, setStep] = useState<"idle" | "choose" | "batch">("idle");   // clicking asks first: one file, or a batch (outline buttons only: neither choice is the "main" one)
  const [isDragging, setIsDragging] = useState(false);
  // A batch is gathered first and sent only when the person presses Upload: files and folders can be added a pick at a time and removed again.
  const [staged, setStaged] = useState<File[]>([]);
  const keyOf = (f: File) => `${(f as any).webkitRelativePath || f.name}|${f.size}|${f.lastModified}`;
  const stage = (fs: File[]) => setStaged((cur) => { const seen = new Set(cur.map(keyOf)); return [...cur, ...fs.filter((f) => !seen.has(keyOf(f)) && seen.add(keyOf(f)))]; });
  const sendStaged = () => { const fs = staged; setStaged([]); setStep("idle"); if (fs.length === 1) onFileUpload(fs[0]); else if (fs.length && onFilesUpload) onFilesUpload(fs); };
  const cancelBatch = () => { setStaged([]); setStep("idle"); };
  const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  const borderColor = useColorModeValue("blue.200", "whiteAlpha.300");
  const bgColor = useColorModeValue("white", "gray.800");
  const bgActiveColor = useColorModeValue("blue.50", "blue.900");
  const accentColor = useColorModeValue("blue.500", "blue.300");
  const textColor = useColorModeValue("gray.800", "gray.100");
  const mutedTextColor = useColorModeValue("gray.600", "gray.400");
  const chipBg = useColorModeValue("blue.50", "whiteAlpha.100");

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (locked) return;
    if (onFilesUpload) {
      const entries = [...e.dataTransfer.items].map((i) => (i as any).webkitGetAsEntry?.()).filter(Boolean);
      const files = entries.length ? (await Promise.all(entries.map(filesOf))).flat() : [...e.dataTransfer.files];
      if (step === "batch") { stage(files); return; }   // while a batch is being gathered, a drop adds to it
      if (files.length > 1) { setStep("idle"); onFilesUpload(files); return; }
      if (files.length === 1) { setStep("idle"); onFileUpload(files[0]); return; }
    }
    const file = e.dataTransfer.files[0];
    if (file) { setStep("idle"); onFileUpload(file); }
  };
  const single = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) onFileUpload(f); e.target.value = ""; setStep("idle"); };
  // One file is a single upload however it was chosen (Batch, Choose files, a folder holding one file, or a drop): a batch is two files or more.
  const many = (e: React.ChangeEvent<HTMLInputElement>) => { const fs = [...(e.target.files ?? [])]; e.target.value = ""; stage(fs); };   // adds to the batch list; nothing is sent yet
  const open = () => { if (locked) return; if (!onFilesUpload) singleRef.current?.click(); else if (step === "idle") setStep("choose"); };

  return (
    <Box
      border="1.5px dashed" borderColor={isDragging ? accentColor : borderColor} borderRadius="2xl" px={5} py={step === "idle" && !locked ? 3 : 5} textAlign="center"
      bg={isDragging ? bgActiveColor : bgColor} transition="all 0.25s ease" fontSize="sm" position="relative"
      boxShadow={isDragging ? `0 0 0 4px ${chipBg}` : "sm"} _hover={locked || step !== "idle" ? undefined : { borderColor: accentColor, boxShadow: "md" }}
      cursor={locked ? "not-allowed" : step === "idle" ? "pointer" : "default"} aria-disabled={!!locked}
      onClick={open}
      onDragOver={(e) => { e.preventDefault(); if (!locked) setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={handleDrop}
    >
      <input type="file" accept={formats.accept} hidden ref={singleRef} onChange={single} />
      {onFilesUpload && <input type="file" accept={formats.accept} multiple hidden ref={multiRef} onChange={many} />}
      {onFilesUpload && <input type="file" hidden ref={folderRef} multiple {...({ webkitdirectory: "" } as object)} onChange={many} />}
      {locked ? (
        <Flex direction="column" align="center" py={2} gap={2} className="rm-reveal">
          <Box w="40px" h="40px" borderRadius="full" bg={chipBg} display="grid" placeItems="center" color={accentColor}><FiLayers size={18} /></Box>
          <Text fontSize="sm" color={textColor} fontWeight="medium" maxW="26ch">{locked.message}</Text>
          {locked.onViewBatch && <Button size="xs" variant="outline" onClick={(e) => { e.stopPropagation(); locked.onViewBatch!(); }}>View the batch</Button>}
        </Flex>
      ) : step === "choose" ? (
        <Flex direction="column" align="center" gap={3} className="rm-reveal" role="group" aria-label="How many files are you adding?">
          <Text fontWeight="semibold" color={textColor}>How many are you adding?</Text>
          <Flex gap={3} wrap="wrap" justify="center">
            <Button size="sm" variant="outline" leftIcon={<FiFile />} onClick={(e) => { e.stopPropagation(); singleRef.current?.click(); }}>Single file</Button>
            <Button size="sm" variant="outline" leftIcon={<FiLayers />} onClick={(e) => { e.stopPropagation(); setStep("batch"); }}>Batch</Button>
          </Flex>
          <Text fontSize="xs" color={mutedTextColor}>A batch is many files or a whole folder. Each document still gets its own record.</Text>
          <IconButton aria-label="Cancel" size="2xs" variant="ghost" onClick={(e) => { e.stopPropagation(); setStep("idle"); }}><FiX /></IconButton>
        </Flex>
      ) : step === "batch" ? (
        <Flex direction="column" align="center" gap={3} className="rm-reveal" role="group" aria-label="Choose what to add in the batch">
          <Text fontWeight="semibold" color={textColor}>{staged.length ? `${staged.length} file${staged.length === 1 ? "" : "s"} ready to upload` : "Add files or folders to the batch"}</Text>
          <Flex gap={3} wrap="wrap" justify="center">
            <Button size="sm" variant="outline" leftIcon={<FiFile />} onClick={(e) => { e.stopPropagation(); multiRef.current?.click(); }}>Add files</Button>
            <Button size="sm" variant="outline" leftIcon={<FiFolder />} onClick={(e) => { e.stopPropagation(); folderRef.current?.click(); }}>Add a folder</Button>
          </Flex>
          {staged.length > 0 ? (
            <Box as="ul" w="100%" maxH="180px" overflowY="auto" textAlign="left" borderWidth="1px" borderColor={borderColor} borderRadius="md" listStyleType="none" m={0} p={0} aria-label="Files in this batch">
              {staged.map((f) => (
                <Flex as="li" key={keyOf(f)} align="center" gap={2} px={3} py={1.5} className="rm-reveal" borderBottomWidth="1px" borderColor={borderColor} _last={{ borderBottomWidth: 0 }}>
                  <Text fontSize="xs" color={textColor} flex={1} minW={0} truncate title={(f as any).webkitRelativePath || f.name}>{(f as any).webkitRelativePath || f.name}</Text>
                  <Text fontSize="xs" color={mutedTextColor} flexShrink={0}>{kb(f.size)}</Text>
                  <IconButton aria-label={`Remove ${f.name}`} size="2xs" variant="ghost" onClick={(e) => { e.stopPropagation(); setStaged((cur) => cur.filter((x) => keyOf(x) !== keyOf(f))); }}><FiX /></IconButton>
                </Flex>))}
            </Box>
          ) : <Text fontSize="xs" color={mutedTextColor}>Pick as many times as you like, or drop files and folders here. Nothing is sent until you press Upload.</Text>}
          <Flex gap={2} justify="center">
            <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); return cancelBatch(); }}>Cancel</Button>
            <Button size="sm" disabled={!staged.length} onClick={(e) => { e.stopPropagation(); return sendStaged(); }}>{staged.length > 1 ? `Upload ${staged.length} files` : staged.length === 1 ? "Upload 1 file" : "Upload"}</Button>
          </Flex>
        </Flex>
      ) : (
        <Flex direction="column" align="center" py={1} gap={1}>
          <Box w="34px" h="34px" borderRadius="full" bg={chipBg} display="grid" placeItems="center" color={accentColor}
            css={{ animation: isDragging ? `${breathe} 0.9s ease-in-out infinite` : undefined }} transition="transform 0.2s ease" transform={isDragging ? "scale(1.1)" : "scale(1)"}>
            <FiUpload size={16} />
          </Box>
          {/* One line, so the two upload boxes on the board are always the same height whatever their wording (owner, 10 Nov 2026: "they should be
              the size of the CV box"); a narrow column ends the wording in "…" and shows it whole on hover. */}
          <Text fontSize="sm" color={textColor} fontWeight="semibold" maxW="100%" truncate title={label}>{label}</Text>
          <Text fontSize="xs" color={mutedTextColor}>{onFilesUpload ? "Drop files or a folder here, or click" : "Drop a file here, or click"}</Text>
        </Flex>
      )}
    </Box>
  );
};

export default DropZone;
