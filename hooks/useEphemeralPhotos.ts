"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EphemeralPhotoDraft, RuntimePhotoAttachment } from "@/lib/photo/types";

export function useEphemeralPhotos() {
  const photosRef = useRef(new Map<string, EphemeralPhotoDraft>());
  const [, setVersion] = useState(0);

  const remove = useCallback((id: string) => {
    const existing = photosRef.current.get(id);
    if (existing) URL.revokeObjectURL(existing.objectUrl);
    photosRef.current.delete(id);
    setVersion((value) => value + 1);
  }, []);

  const add = useCallback((photo: EphemeralPhotoDraft) => {
    const existing = photosRef.current.get(photo.id);
    if (existing && existing.objectUrl !== photo.objectUrl) URL.revokeObjectURL(existing.objectUrl);
    photosRef.current.set(photo.id, photo);
    setVersion((value) => value + 1);
  }, []);

  const clear = useCallback(() => {
    for (const photo of photosRef.current.values()) URL.revokeObjectURL(photo.objectUrl);
    photosRef.current.clear();
    setVersion((value) => value + 1);
  }, []);

  useEffect(() => clear, [clear]);

  return {
    add,
    remove,
    clear,
    get: (id: string) => photosRef.current.get(id),
    has: (id: string) => photosRef.current.has(id),
    attachments: (ids?: Set<string>): RuntimePhotoAttachment[] => [...photosRef.current.values()]
      .filter((photo) => photo.status === "approved" && (!ids || ids.has(photo.id)))
      .map((photo) => ({ metadata: photo, blob: photo.blob }))
  };
}
