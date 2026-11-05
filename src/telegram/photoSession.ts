import { InputFile, InputMediaBuilder } from "grammy";
import type { MessageEntity } from "grammy/types";
import path from "node:path";
import type { Conv, ConvContext, BotEnv } from "./context.js";
import {
  CB,
  mainMenuKb,
  photoIdleKb,
  photoPreviewKb,
  placeKb,
  workingKb,
} from "./keyboards.js";
import { scanFileName } from "../core/services.js";
import { errorMessage } from "../util/exec.js";
import {
  detectPhoto,
  renderPhoto,
  renderPreview,
  type Box,
  type Rotation,
} from "../photo/crop.js";
import {
  isSameAnswer,
  isUnknownAnswer,
  parseApproxDate,
  type ApproxDate,
} from "../photo/dates.js";
import { geocode, type Place } from "../photo/geocode.js";
import { ImmichClient } from "../photo/immich.js";

/**
 * Paper photo → Immich, one photo at a time: scan the platen at high
 * resolution, crop the photo out of the white lid, let the person rotate it,
 * ask roughly when and where it was taken, upload with that metadata.
 *
 * Questions are asked with force_reply so that the answers reach the bot in
 * groups too, where privacy mode only delivers replies to the bot's messages.
 */
export function photoSession(env: BotEnv) {
  const { services, t, kb } = env;
  const { scanner, sessions, log, config } = services;
  const photos = config.photos!;
  const http = env.http ?? fetch;
  const language = config.telegram?.language;

  return async function photoSessionConversation(
    conv: Conv,
    ctx: ConvContext,
  ): Promise<void> {
    const user = ctx.from;
    if (!user) return;
    const apiKey = photos.apiKeys.get(user.id) ?? photos.defaultApiKey;
    if (!apiKey) {
      await ctx.reply(t.photoNoKey, { reply_markup: mainMenuKb(t, kb) });
      return;
    }
    const inGroup = ctx.chat?.type !== "private";

    const session = await conv.external(() => sessions.create(`photo-${user.id}`));
    const rawPath = path.join(session.dir, "scan.jpg");
    const previewPath = path.join(session.dir, "preview.jpg");
    const finalPath = path.join(session.dir, "photo.jpg");

    let uploaded = 0;
    // undefined = there was no previous photo; null = it was "unknown".
    let prevDate: ApproxDate | null | undefined;
    let prevPlace: Place | null | undefined;

    /** Wait for one of `allowed` buttons; other buttons and plain text are ignored. */
    const waitButton = async (allowed: string[]) => {
      while (true) {
        const u = await conv.waitFor(["callback_query:data", "message:text"]);
        if (u.callbackQuery) {
          if (allowed.includes(u.callbackQuery.data)) return u;
          await u.answerCallbackQuery();
          continue;
        }
        if (u.message?.text?.startsWith("/")) await conv.skip();
      }
    };

    /** Ask with force_reply and return the text answer (or a pressed button). */
    const ask = async (text: string, placeholder: string) => {
      // In a group the reply prompt pops up only for the person being asked.
      const name = user.first_name;
      const entities: MessageEntity[] = inGroup
        ? [{ type: "text_mention", offset: 0, length: name.length, user }]
        : [];
      await ctx.reply(inGroup ? `${name}, ${text}` : text, {
        entities,
        reply_markup: {
          force_reply: true,
          selective: inGroup,
          input_field_placeholder: placeholder,
        },
      });
    };
    const waitText = async (buttons: string[] = []) => {
      while (true) {
        const u = await conv.waitFor(["message:text", "callback_query:data"]);
        if (u.callbackQuery) {
          if (buttons.includes(u.callbackQuery.data)) {
            await u.answerCallbackQuery();
            return { button: u.callbackQuery.data };
          }
          await u.answerCallbackQuery();
          continue;
        }
        const text = u.message!.text!;
        if (text.startsWith("/")) await conv.skip();
        return { text: text.trim() };
      }
    };

    const finish = async () => {
      await conv.external(() => sessions.discard(session));
      await ctx.reply(t.photoFinished(uploaded), { reply_markup: mainMenuKb(t, kb) });
    };

    await ctx.reply(t.photoIntro(photos.dpi, photos.album), {
      reply_markup: photoIdleKb(t),
    });

    // ── idle: wait for "Scan" / "Finish" ─────────────────────────────────
    idle: while (true) {
      const start = await waitButton([CB.photoScan, CB.photoDone]);
      if (start.callbackQuery!.data === CB.photoDone) {
        await start.answerCallbackQuery();
        await start.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
        await finish();
        return;
      }

      // ── scan, preview, rotate / rescan ─────────────────────────────────
      let box: Box | undefined;
      let rotation: Rotation = 0;
      let trigger = start;
      scanning: while (true) {
        if (await conv.external(() => scanner.isBusy())) {
          await trigger.answerCallbackQuery({ text: t.busy, show_alert: true });
          continue idle;
        }
        await trigger.answerCallbackQuery();
        const status = await ctx.reply(t.photoScanning(photos.dpi), {
          reply_markup: workingKb(t),
        });
        const removeTriggerButtons = trigger
          .editMessageReplyMarkup({ reply_markup: undefined })
          .catch(() => {});
        await removeTriggerButtons;
        try {
          const found = await conv.external(async () => {
            await scanner.scanPhoto(rawPath, photos.dpi, photos.esclUrl);
            const b = await detectPhoto(rawPath);
            await renderPreview(rawPath, previewPath, { box: b, rotation: 0 });
            return b ?? null;
          });
          box = found ?? undefined;
          rotation = 0;
        } catch (err) {
          log.error({ err }, "photo scan failed");
          await ctx.api.editMessageText(
            status.chat.id,
            status.message_id,
            t.scanFailed(errorMessage(err)),
            { reply_markup: photoIdleKb(t) },
          );
          continue idle;
        }
        await ctx.api.editMessageText(status.chat.id, status.message_id, t.photoScanned);

        const caption = box ? t.photoPreview : t.photoNotFound;
        const preview = await ctx.replyWithPhoto(new InputFile(previewPath), {
          caption,
          reply_markup: photoPreviewKb(t),
        });

        while (true) {
          const c = await waitButton([
            CB.photoRotate,
            CB.photoRescan,
            CB.photoNext,
            CB.photoDrop,
          ]);
          const data = c.callbackQuery!.data;
          if (data === CB.photoRotate) {
            await c.answerCallbackQuery();
            rotation = ((rotation + 90) % 360) as Rotation;
            const r = rotation;
            await conv.external(() =>
              renderPreview(rawPath, previewPath, { box, rotation: r }),
            );
            await ctx.api.editMessageMedia(
              preview.chat.id,
              preview.message_id,
              InputMediaBuilder.photo(new InputFile(previewPath), { caption }),
              { reply_markup: photoPreviewKb(t) },
            );
            continue;
          }
          await ctx.api
            .editMessageReplyMarkup(preview.chat.id, preview.message_id, {
              reply_markup: undefined,
            })
            .catch(() => {});
          if (data === CB.photoRescan) {
            trigger = c;
            continue scanning;
          }
          if (data === CB.photoDrop) {
            await c.answerCallbackQuery();
            await ctx.reply(t.photoDropped, { reply_markup: photoIdleKb(t) });
            continue idle;
          }
          await c.answerCallbackQuery();
          break scanning;
        }
      }

      // ── when ───────────────────────────────────────────────────────────
      let date: ApproxDate | null;
      await ask(t.askDate(prevDate !== undefined, prevDate?.label), t.datePlaceholder);
      while (true) {
        const { text } = await waitText();
        if (text === undefined) continue;
        if (isUnknownAnswer(text)) {
          date = null;
          break;
        }
        if (isSameAnswer(text) && prevDate !== undefined) {
          date = prevDate;
          break;
        }
        const parsed = await conv.external(() => parseApproxDate(text) ?? null);
        if (parsed) {
          date = parsed;
          break;
        }
        await ask(t.dateNotUnderstood, t.datePlaceholder);
      }

      // ── where ──────────────────────────────────────────────────────────
      let place: Place | null = null;
      const prevPlaceName = prevPlace
        ? (prevPlace.displayName ?? prevPlace.query)
        : undefined;
      await ask(t.askPlace(prevPlace !== undefined, prevPlaceName), t.placePlaceholder);
      where: while (true) {
        const { text } = await waitText();
        if (text === undefined) continue;
        if (isUnknownAnswer(text)) {
          place = null;
          break;
        }
        if (isSameAnswer(text) && prevPlace !== undefined) {
          place = prevPlace;
          break;
        }
        if (!photos.geocoderUrl) {
          place = { query: text };
          break;
        }
        const hit = await conv.external(async () => {
          try {
            return (
              (await geocode(photos.geocoderUrl!, text, { language, fetchImpl: http })) ??
              null
            );
          } catch (err) {
            log.warn({ err }, "geocoding failed");
            return null;
          }
        });
        await ctx.reply(hit ? t.placeFound(hit.displayName!) : t.placeNotFound(text), {
          reply_markup: placeKb(t, hit !== null),
        });
        const c = await waitButton([CB.placeOk, CB.placeRetry, CB.placeNoGeo]);
        await c.answerCallbackQuery();
        await c.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
        const data = c.callbackQuery!.data;
        if (data === CB.placeOk && hit) {
          place = hit;
          break where;
        }
        if (data === CB.placeNoGeo) {
          place = { query: text };
          break where;
        }
        await ask(t.askPlace(false), t.placePlaceholder);
      }

      // ── upload ─────────────────────────────────────────────────────────
      const status = await ctx.reply(t.uploading, { reply_markup: workingKb(t) });
      const description = t.photoDescription(
        date ? { label: date.label, exact: date.precision === "day" } : undefined,
        place ? place.query : undefined,
      );
      const r = rotation;
      try {
        const result = await conv.external(async () => {
          const takenAt = date ? `${date.date}T12:00:00.000Z` : new Date().toISOString();
          await renderPhoto(rawPath, finalPath, {
            box,
            rotation: r,
            exifDate: date ? `${date.date.replace(/-/g, ":")} 12:00:00` : undefined,
          });
          const immich = new ImmichClient(photos.immichUrl, apiKey, http);
          const id = await immich.upload(finalPath, scanFileName("jpg"), takenAt);
          await immich.update(id, {
            dateTimeOriginal: date ? takenAt : undefined,
            latitude: place?.latitude,
            longitude: place?.longitude,
            description,
          });
          let albumError: string | null = null;
          if (photos.album) {
            try {
              const albumId = await immich.ensureAlbum(
                photos.album,
                photos.albumShareWith,
              );
              await immich.addToAlbum(albumId, [id]);
            } catch (err) {
              log.warn({ err }, "adding to album failed");
              albumError = errorMessage(err);
            }
          }
          return { id, albumError };
        });
        uploaded += 1;
        prevDate = date;
        prevPlace = place;
        const link = `${photos.publicUrl}/photos/${result.id}`;
        await ctx.api.editMessageText(
          status.chat.id,
          status.message_id,
          t.uploaded(link, uploaded) +
            (result.albumError ? `\n${t.albumFailed(result.albumError)}` : ""),
          { reply_markup: photoIdleKb(t), link_preview_options: { is_disabled: true } },
        );
      } catch (err) {
        log.error({ err }, "immich upload failed");
        await ctx.api.editMessageText(
          status.chat.id,
          status.message_id,
          t.uploadFailed(errorMessage(err)),
          { reply_markup: photoIdleKb(t) },
        );
      }
    }
  };
}
