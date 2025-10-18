import { Session, Slide, SlideType, Stroke } from '@prisma/client';
import { env, publicPaths } from '../config/env';

const buildPublicUrl = (relative: string): string => {
  const normalized = relative.startsWith('/') ? relative : `/${relative}`;
  return `${env.ASSET_BASE_URL}${normalized}`;
};

const pdfPlaceholderUrl = buildPublicUrl(`${publicPaths.static}/placeholders/pdf.svg`);

export type SlideResponse = {
  id: string;
  sessionId: string;
  type: SlideType;
  title: string | null;
  assetUrl: string | null;
  previewUrl: string | null;
  mimeType: string | null;
  size: number | null;
  order: number;
  createdAt: string;
  originalName: string | null;
};

export const serializeSlide = (slide: Slide): SlideResponse => {
  const assetRelative = slide.assetFilename ? `${publicPaths.uploads}/${slide.assetFilename}` : null;
  const assetUrl = assetRelative ? buildPublicUrl(assetRelative) : null;
  const previewUrl =
    slide.type === SlideType.PDF
      ? pdfPlaceholderUrl
      : slide.type === SlideType.IMAGE
      ? assetUrl
      : null;

  return {
    id: slide.id,
    sessionId: slide.sessionId,
    type: slide.type,
    title: slide.title,
    assetUrl,
    previewUrl,
    mimeType: slide.assetMimeType,
    size: slide.assetSize,
    order: slide.order,
    createdAt: slide.createdAt.toISOString(),
    originalName: slide.assetOriginalName
  };
};

export type SessionResponse = {
  sessionId: string;
  title: string;
  description: string | null;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  chatEnabled: boolean;
  currentSlideId: string | null;
  createdAt: string;
  updatedAt: string;
  slides: SlideResponse[];
};

export const serializeSession = (session: Session & { slides: Slide[] }): SessionResponse => ({
  sessionId: session.id,
  title: session.title,
  description: session.description,
  status: session.status,
  startedAt: session.startedAt?.toISOString() ?? null,
  endedAt: session.endedAt?.toISOString() ?? null,
  chatEnabled: session.chatEnabled,
  currentSlideId: session.currentSlideId,
  createdAt: session.createdAt.toISOString(),
  updatedAt: session.updatedAt.toISOString(),
  slides: session.slides
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(serializeSlide)
});

export type StrokeResponse = {
  id: string;
  sessionId: string;
  slideId: string;
  payload: unknown;
  createdAt: string;
  createdById: string;
};

export const serializeStroke = (stroke: Stroke): StrokeResponse => ({
  id: stroke.id,
  sessionId: stroke.sessionId,
  slideId: stroke.slideId,
  payload: stroke.payload,
  createdAt: stroke.createdAt.toISOString(),
  createdById: stroke.createdById
});

export const getPdfPlaceholderUrl = () => pdfPlaceholderUrl;

export const publicUrlBuilder = buildPublicUrl;
