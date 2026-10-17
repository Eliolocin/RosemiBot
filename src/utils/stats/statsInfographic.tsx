/**
 * Pure satori renderers for the `/stats generate` infographics.
 * Gatherers provide the complete data structs; this module never reads the DB
 * or Discord API.
 */
import { TIMEFRAME_LABEL_KEYS } from "@/utils/discord/statsDashboardCatalog";
import type { Timeframe } from "@/utils/stats/statsDashboard";
import { localizer } from "@/utils/text/localizer";

export interface VNode {
  type: string;
  props: Record<string, unknown> & { children?: unknown };
}

declare global {
  namespace JSX {
    type Element = VNode;
    interface IntrinsicElements {
      [tag: string]: Record<string, unknown> & { children?: unknown };
    }
  }
}

export function h(
  type: string | ((props: Record<string, unknown> & { children?: unknown }) => unknown),
  props: Record<string, unknown> | null,
  ...children: unknown[]
): VNode {
  const flatChildren = children.flat();
  const normalizedChildren =
    flatChildren.length === 0 ? undefined : flatChildren.length === 1 ? flatChildren[0] : flatChildren;
  const mergedProps = { ...(props ?? {}), children: normalizedChildren };

  if (typeof type === "function") return type(mergedProps) as VNode;
  return { type, props: mergedProps };
}

export function Fragment(props: { children?: unknown }): unknown {
  return props.children;
}

/** Logical canvas width. All typography is sized for a Discord-scale preview. */
export const CARD_W = 1080;
const BASE_CARD_W = 1080;
const CARD_SCALE = CARD_W / BASE_CARD_W;

function scaled(value: number): number {
  return Math.max(1, Math.round(value * CARD_SCALE));
}

/** Cards deliberately use different heights for their share-card layouts. */
export const PERSONAL_CARD_H = scaled(1920);
export const PERSONA_CARD_H = scaled(1920);
/** @deprecated Use the card-specific height helpers instead. */
export const CARD_H = PERSONAL_CARD_H;

/** TomoriBot brand palette. */
export const CARD_THEME = {
  bg: "#1d100e",
  surface: "#2c1815",
  surfaceAlt: "#160b0a",
  border: "#4d2b26",
  text: "#f7f2f1",
  textMuted: "#d1b8b2",
  textSubtle: "#ab8981",
  red: "#e7322a",
  magenta: "#db1458",
  cyan: "#00e5ff",
  teal: "#6ec4cf",
  activity: "#f56a3f",
  fontFamily: "Noto Sans JP",
} as const;

function formatInt(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatCost(value: number): string {
  return `$${value.toFixed(4)}`;
}

function timeframeLabel(locale: string, timeframe: Timeframe): string {
  return localizer(locale, TIMEFRAME_LABEL_KEYS[timeframe]);
}

export interface PersonIcon {
  name: string;
  avatarDataUri: string | null;
}

export interface EmojiIcon {
  name: string;
  imageDataUri: string | null;
}

export interface BreakdownSegment {
  label: string;
  count: number;
}

function arcPoint(cx: number, cy: number, radius: number, angle: number): { x: number; y: number } {
  const radians = ((angle - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

/** Produces a data-URI-safe SVG donut without unsupported CSS conic gradients. */
export function buildDonutSvg(
  segments: Array<{ value: number; color: string }>,
  size = 112,
  thickness = 20,
  trackColor: string = CARD_THEME.surfaceAlt,
): string {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  const radius = (size - thickness) / 2;
  const center = size / 2;
  const track = `<circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="${trackColor}" stroke-width="${thickness}"/>`;

  if (total === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${track}</svg>`;
  }

  let cursor = 0;
  const paths = segments
    .filter((segment) => segment.value > 0)
    .map((segment) => {
      const portion = (segment.value / total) * 360;
      const start = arcPoint(center, center, radius, cursor);
      const end = arcPoint(center, center, radius, cursor + Math.min(portion, 359.999));
      cursor += portion;
      const largeArc = portion > 180 ? 1 : 0;
      return `<path d="M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}" fill="none" stroke="${segment.color}" stroke-width="${thickness}" stroke-linecap="butt"/>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${track}${paths}</svg>`;
}

export interface PersonalCardPalette {
  background: string;
  surface: string;
  ink: string;
  muted: string;
  accent: string;
  accentSecondary: string;
  border: string;
}

/** Neutral fallback used when the leading persona has no usable avatar image. */
export const DEFAULT_PERSONAL_CARD_PALETTE: PersonalCardPalette = {
  background: "#f6f5ef",
  surface: "#eae7dc",
  ink: "#1e1d19",
  muted: "#54514a",
  accent: "#2f6259",
  accentSecondary: "#315c87",
  border: "#c3c9c1",
};

export interface PersonalFavoritePersona extends PersonIcon {
  totalTokens: number;
  estimatedCost: number;
}

export interface PersonalCardData {
  locale: string;
  timeframe: Timeframe;
  username: string;
  userAvatarDataUri: string | null;
  tomoriconDataUri: string | null;
  palette: PersonalCardPalette;
  totalTokens: number;
  totalTriggers: number;
  estimatedCost: number;
  favoritePersonas: PersonalFavoritePersona[];
  favoriteModelName: string | null;
}

function truncateCardText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, Math.max(1, maxLength - 3))}...` : value;
}

function PersonalImage(
  props: Record<string, unknown> & {
    name: string;
    dataUri: string | null;
    size: number;
    palette: PersonalCardPalette;
    rounded?: boolean;
  },
): VNode {
  const initials = props.name.trim().slice(0, 1).toUpperCase() || "?";
  return (
    <div
      style={{
        display: "flex",
        width: props.size,
        height: props.size,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        borderRadius: props.rounded ? "50%" : scaled(18),
        border: `${scaled(2)}px solid ${props.palette.accent}`,
        backgroundColor: props.palette.surface,
        color: props.palette.ink,
        fontSize: Math.max(scaled(24), Math.round(props.size * 0.35)),
        fontWeight: 700,
      }}
    >
      {props.dataUri ? (
        <img
          src={props.dataUri}
          alt=""
          width={props.size}
          height={props.size}
          style={{ display: "flex", width: props.size, height: props.size, objectFit: "cover" }}
        />
      ) : (
        initials
      )}
    </div>
  );
}

function PersonalRankingRow(
  props: Record<string, unknown> & {
    entry: PersonalFavoritePersona;
    rank: number;
    palette: PersonalCardPalette;
  },
): VNode {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        minHeight: scaled(82),
        flexDirection: "row",
        alignItems: "center",
        borderTop: `${scaled(1)}px solid ${props.palette.border}`,
      }}
    >
      <div
        style={{
          display: "flex",
          width: scaled(62),
          color: props.palette.accent,
          fontSize: scaled(34),
          fontWeight: 700,
        }}
      >
        #{props.rank}
      </div>
      <div
        style={{
          display: "flex",
          flex: 1,
          color: props.palette.ink,
          fontSize: scaled(38),
          fontWeight: 700,
        }}
      >
        {truncateCardText(props.entry.name, 16)}
      </div>
      <div
        style={{
          display: "flex",
          width: scaled(254),
          justifyContent: "flex-end",
          color: props.palette.muted,
          fontSize: scaled(34),
          lineHeight: 1.15,
          textAlign: "right",
        }}
      >
        {formatInt(props.entry.totalTokens)}
      </div>
      <div
        style={{
          display: "flex",
          width: scaled(184),
          justifyContent: "flex-end",
          color: props.palette.muted,
          fontSize: scaled(34),
          lineHeight: 1.15,
          textAlign: "right",
        }}
      >
        {formatCost(props.entry.estimatedCost)}
      </div>
    </div>
  );
}

function PersonalRankingHeader(
  props: Record<string, unknown> & {
    favoritePersonas: string;
    tokens: string;
    spent: string;
    palette: PersonalCardPalette;
  },
): VNode {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        minHeight: scaled(64),
        flexDirection: "row",
        alignItems: "center",
        borderBottom: `${scaled(2)}px solid ${props.palette.accent}`,
      }}
    >
      <div style={{ display: "flex", flex: 1, color: props.palette.accent, fontSize: scaled(38), fontWeight: 700 }}>
        {props.favoritePersonas}
      </div>
      <div
        style={{
          display: "flex",
          width: scaled(254),
          justifyContent: "flex-end",
          color: props.palette.accent,
          fontSize: scaled(30),
          fontWeight: 700,
        }}
      >
        {props.tokens}
      </div>
      <div
        style={{
          display: "flex",
          width: scaled(184),
          justifyContent: "flex-end",
          color: props.palette.accent,
          fontSize: scaled(30),
          fontWeight: 700,
        }}
      >
        {props.spent}
      </div>
    </div>
  );
}

function PersonalTotal(
  props: Record<string, unknown> & { label: string; value: string; palette: PersonalCardPalette },
): VNode {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "48%" }}>
      <div style={{ display: "flex", color: props.palette.muted, fontSize: scaled(30), fontWeight: 700 }}>
        {props.label}
      </div>
      <div
        style={{ display: "flex", color: props.palette.ink, fontSize: scaled(76), fontWeight: 700, lineHeight: 1.05 }}
      >
        {props.value}
      </div>
    </div>
  );
}

/** Personal Wrapped is intentionally a tall 9:16 card for Discord previews. */
export function getPersonalCardHeight(_data: PersonalCardData): number {
  return PERSONAL_CARD_H;
}

export function renderPersonalCard(data: PersonalCardData): VNode {
  const t = {
    totalTokens: localizer(data.locale, "commands.stats.infographic.personal_total_tokens"),
    totalSpent: localizer(data.locale, "commands.stats.infographic.total_spent"),
    favoritePersonas: localizer(data.locale, "commands.stats.infographic.favorite_personas"),
    favoriteModel: localizer(data.locale, "commands.stats.infographic.favorite_model"),
    tokens: localizer(data.locale, "commands.stats.infographic.tokens"),
    spent: localizer(data.locale, "commands.stats.infographic.spent"),
    footerBrand: localizer(data.locale, "commands.stats.infographic.personal_wrapped_footer", {
      timeframe: timeframeLabel(data.locale, data.timeframe).toUpperCase(),
    }),
    noData: localizer(data.locale, "commands.stats.infographic.no_data"),
  };

  const hasData = data.totalTriggers > 0;
  const palette = data.palette ?? DEFAULT_PERSONAL_CARD_PALETTE;
  const favorite = data.favoritePersonas[0];
  return (
    <div
      style={{
        display: "flex",
        width: CARD_W,
        height: getPersonalCardHeight(data),
        boxSizing: "border-box",
        overflow: "hidden",
        flexDirection: "column",
        backgroundColor: palette.background,
        color: palette.ink,
        fontFamily: CARD_THEME.fontFamily,
      }}
    >
      <div style={{ display: "flex", width: "100%", height: scaled(900), flexDirection: "row" }}>
        <div
          style={{
            display: "flex",
            width: scaled(138),
            flexShrink: 0,
            position: "relative",
            flexDirection: "column",
            alignItems: "center",
            paddingTop: scaled(34),
            paddingBottom: scaled(40),
            borderRight: `${scaled(1)}px solid ${palette.border}`,
          }}
        >
          <PersonalImage
            name={data.username}
            dataUri={data.userAvatarDataUri}
            size={scaled(78)}
            palette={palette}
            rounded
          />
          <div
            style={{
              display: "flex",
              position: "absolute",
              top: scaled(150),
              left: scaled(108),
              width: scaled(700),
              color: palette.ink,
              fontSize: scaled(58),
              fontWeight: 700,
              letterSpacing: scaled(1),
              transform: "rotate(90deg)",
              transformOrigin: "top left",
            }}
          >
            {truncateCardText(data.username, 18)}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flex: 1,
            paddingTop: scaled(42),
            paddingRight: scaled(42),
            paddingLeft: scaled(42),
          }}
        >
          <div
            style={{
              display: "flex",
              position: "relative",
              width: "100%",
              height: scaled(820),
              justifyContent: "flex-end",
              alignItems: "flex-end",
            }}
          >
            <div
              style={{
                display: "flex",
                position: "relative",
                marginRight: scaled(24),
                marginBottom: -scaled(24),
              }}
            >
              {/* Three-layer stacked-card silhouette floating on the card background
                  (no panel/border), each square the same size as the avatar and
                  staggered up-left: accent back → secondary-accent mid → avatar front.
                  Personal-only (it replaces PersonalHeroDecor here), so the Server card
                  (which still uses the shared decor) is unaffected. */}
              <div
                style={{
                  display: "flex",
                  position: "absolute",
                  top: -scaled(80),
                  left: -scaled(80),
                  width: scaled(760),
                  height: scaled(760),
                  borderRadius: scaled(18),
                  backgroundColor: palette.accent,
                }}
              />
              <div
                style={{
                  display: "flex",
                  position: "absolute",
                  top: -scaled(40),
                  left: -scaled(40),
                  width: scaled(760),
                  height: scaled(760),
                  borderRadius: scaled(18),
                  backgroundColor: palette.accentSecondary,
                }}
              />
              <div style={{ display: "flex", position: "relative", boxShadow: "0 28px 52px rgba(0, 0, 0, 0.22)" }}>
                <PersonalImage
                  name={favorite?.name ?? data.username}
                  dataUri={favorite?.avatarDataUri ?? null}
                  size={scaled(760)}
                  palette={palette}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          paddingTop: scaled(36),
          paddingRight: scaled(66),
          paddingBottom: scaled(40),
          paddingLeft: scaled(66),
        }}
      >
        <PersonalRankingHeader
          favoritePersonas={t.favoritePersonas}
          tokens={t.tokens}
          spent={t.spent}
          palette={palette}
        />
        {hasData ? (
          data.favoritePersonas
            .slice(0, 5)
            .map((entry, index) => (
              <PersonalRankingRow key={entry.name} entry={entry} rank={index + 1} palette={palette} />
            ))
        ) : (
          <div style={{ display: "flex", color: palette.muted, fontSize: scaled(40), paddingTop: scaled(28) }}>
            {t.noData}
          </div>
        )}
        <div
          style={{
            display: "flex",
            width: "100%",
            minHeight: scaled(106),
            marginTop: scaled(28),
            paddingTop: scaled(20),
            paddingBottom: scaled(20),
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: `${scaled(1)}px solid ${palette.border}`,
            borderBottom: `${scaled(1)}px solid ${palette.border}`,
          }}
        >
          <div style={{ display: "flex", color: palette.accent, fontSize: scaled(32), fontWeight: 700 }}>
            {t.favoriteModel}
          </div>
          <div
            style={{
              display: "flex",
              maxWidth: "66%",
              color: palette.ink,
              fontSize: scaled(38),
              fontWeight: 700,
              textAlign: "right",
            }}
          >
            {data.favoriteModelName ?? t.noData}
          </div>
        </div>
        {/* Spacer pushes the aggregate totals + signature to the card bottom. */}
        <div style={{ display: "flex", flex: 1, minHeight: scaled(20) }} />
        <div
          style={{
            display: "flex",
            width: "100%",
            paddingTop: scaled(26),
            flexDirection: "row",
            justifyContent: "space-between",
            borderTop: `${scaled(2)}px solid ${palette.accent}`,
          }}
        >
          <PersonalTotal label={t.totalTokens} value={formatInt(data.totalTokens)} palette={palette} />
          <PersonalTotal label={t.totalSpent} value={formatCost(data.estimatedCost)} palette={palette} />
        </div>
        <div
          style={{
            display: "flex",
            width: "100%",
            marginTop: scaled(24),
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              width: scaled(86),
              height: scaled(86),
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {data.tomoriconDataUri ? (
              <img
                src={data.tomoriconDataUri}
                alt=""
                width={scaled(80)}
                height={scaled(80)}
                style={{ display: "flex", width: scaled(80), height: scaled(80), objectFit: "contain" }}
              />
            ) : null}
          </div>
          <div
            style={{
              display: "flex",
              color: palette.ink,
              fontSize: scaled(34),
              fontWeight: 700,
              letterSpacing: scaled(1),
            }}
          >
            {t.footerBrand}
          </div>
        </div>
      </div>
    </div>
  );
}

export interface PersonaCardData {
  locale: string;
  timeframe: Timeframe;
  username: string;
  userAvatarDataUri: string | null;
  personaName: string;
  personaAvatarDataUri: string | null;
  tomoriconDataUri: string | null;
  palette: PersonalCardPalette;
  userPalette: PersonalCardPalette;
  inputTokens: number;
  outputTokens: number;
  totalTriggers: number;
  estimatedCost: number;
  memoryCount: number | null;
  conditioning: { rewards: number; punishments: number };
  favoriteEmojis: EmojiIcon[];
  favoriteEmotions: BreakdownSegment[];
  favoriteTools: BreakdownSegment[];
}

/** Time-window cards omit the all-time memory row and use a shorter portrait frame. */
export function getPersonaCardHeight(data: PersonaCardData): number {
  return data.totalTriggers === 0 ? scaled(860) : data.memoryCount === null ? scaled(1800) : PERSONA_CARD_H;
}

/** Large light-mode avatar used only by the centered Persona Affinity identity block. */
function PersonaImage(
  props: Record<string, unknown> & {
    name: string;
    dataUri: string | null;
    size: number;
    accent: string;
    palette: PersonalCardPalette;
  },
): VNode {
  const initials = props.name.trim().slice(0, 1).toUpperCase() || "?";
  return (
    <div
      style={{
        display: "flex",
        width: props.size,
        height: props.size,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        borderRadius: "50%",
        border: `${scaled(5)}px solid ${props.accent}`,
        backgroundColor: props.palette.surface,
        color: props.palette.ink,
        fontSize: Math.max(scaled(34), Math.round(props.size * 0.36)),
        fontWeight: 700,
      }}
    >
      {props.dataUri ? (
        <img
          src={props.dataUri}
          alt=""
          width={props.size}
          height={props.size}
          style={{ display: "flex", width: props.size, height: props.size, objectFit: "cover" }}
        />
      ) : (
        initials
      )}
    </div>
  );
}

function PersonaAvatarStack(
  props: Record<string, unknown> & {
    username: string;
    userAvatarDataUri: string | null;
    personaName: string;
    personaAvatarDataUri: string | null;
    palette: PersonalCardPalette;
  },
): VNode {
  const size = scaled(290);
  return (
    <div style={{ display: "flex", position: "relative", width: scaled(540), height: scaled(330) }}>
      <div style={{ display: "flex", position: "absolute", top: 0, left: scaled(24) }}>
        <PersonaImage
          name={props.username}
          dataUri={props.userAvatarDataUri}
          size={size}
          accent={props.palette.accentSecondary}
          palette={props.palette}
        />
      </div>
      <div style={{ display: "flex", position: "absolute", right: scaled(24), bottom: 0 }}>
        <PersonaImage
          name={props.personaName}
          dataUri={props.personaAvatarDataUri}
          size={size}
          accent={props.palette.accent}
          palette={props.palette}
        />
      </div>
    </div>
  );
}

function PersonaTokenMetric(
  props: Record<string, unknown> & { label: string; value: string; palette: PersonalCardPalette; bordered?: boolean },
): VNode {
  return (
    <div
      style={{
        display: "flex",
        flex: 1,
        minHeight: scaled(120),
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        paddingRight: scaled(14),
        paddingLeft: scaled(14),
        ...(props.bordered ? { borderLeft: `${scaled(1)}px solid ${props.palette.border}` } : {}),
      }}
    >
      <div
        style={{
          display: "flex",
          color: props.palette.muted,
          fontSize: scaled(26),
          fontWeight: 700,
          textAlign: "center",
        }}
      >
        {props.label}
      </div>
      <div
        style={{
          display: "flex",
          marginTop: scaled(8),
          color: props.palette.ink,
          fontSize: scaled(52),
          fontWeight: 700,
        }}
      >
        {props.value}
      </div>
    </div>
  );
}

function PersonaDetailRow(
  props: Record<string, unknown> & { label: string; palette: PersonalCardPalette; children?: unknown },
): VNode {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        minHeight: scaled(106),
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        borderTop: `${scaled(1)}px solid ${props.palette.border}`,
      }}
    >
      <div style={{ display: "flex", flex: 1, color: props.palette.accent, fontSize: scaled(30), fontWeight: 700 }}>
        {props.label}
      </div>
      <div style={{ display: "flex", maxWidth: "56%", flexShrink: 0, justifyContent: "flex-end" }}>
        {props.children}
      </div>
    </div>
  );
}

function PersonaEmojiList(
  props: Record<string, unknown> & { emojis: EmojiIcon[]; empty: string; palette: PersonalCardPalette },
): VNode {
  if (props.emojis.length === 0) {
    return <div style={{ display: "flex", color: props.palette.muted, fontSize: scaled(26) }}>{props.empty}</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "row", gap: scaled(10), justifyContent: "flex-end" }}>
      {props.emojis.slice(0, 5).map((emoji) => (
        <div
          key={emoji.name}
          style={{
            display: "flex",
            width: scaled(70),
            height: scaled(70),
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            borderRadius: scaled(14),
            backgroundColor: props.palette.surface,
          }}
        >
          {emoji.imageDataUri ? (
            <img
              src={emoji.imageDataUri}
              alt=""
              width={scaled(56)}
              height={scaled(56)}
              style={{ display: "flex", width: scaled(56), height: scaled(56), objectFit: "contain" }}
            />
          ) : (
            <div style={{ display: "flex", color: props.palette.muted, fontSize: scaled(18), textAlign: "center" }}>
              {emoji.name.slice(0, 8)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function PersonaBreakdownChart(
  props: Record<string, unknown> & {
    title: string;
    segments: BreakdownSegment[];
    empty: string;
    palette: PersonalCardPalette;
    alignment: "left" | "right";
  },
): VNode {
  const segments = props.segments.slice(0, 4);
  const colors = [props.palette.accent, props.palette.accentSecondary, props.palette.muted, props.palette.ink];
  const size = scaled(226);
  const contentWidth = scaled(760);
  const svg = buildDonutSvg(
    segments.map((segment, index) => ({ value: segment.count, color: colors[index] })),
    size,
    scaled(30),
    props.palette.surface,
  );
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        flexDirection: "column",
        alignItems: props.alignment === "left" ? "flex-start" : "flex-end",
      }}
    >
      <div
        style={{
          display: "flex",
          width: contentWidth,
          marginBottom: scaled(18),
          color: props.palette.accent,
          fontSize: scaled(38),
          fontWeight: 700,
          justifyContent: props.alignment === "left" ? "flex-start" : "flex-end",
          textAlign: props.alignment,
        }}
      >
        {props.title}
      </div>
      <div
        style={{ display: "flex", width: contentWidth, flexDirection: "row", alignItems: "center", gap: scaled(26) }}
      >
        {props.alignment === "left" ? (
          <img src={dataUri} alt="" width={size} height={size} style={{ display: "flex", width: size, height: size }} />
        ) : null}
        {segments.length > 0 ? (
          <div style={{ display: "flex", flex: 1, flexDirection: "column", gap: scaled(13) }}>
            {segments.map((segment, index) => (
              <div
                key={segment.label}
                style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: scaled(8) }}
              >
                <div
                  style={{
                    display: "flex",
                    width: scaled(16),
                    height: scaled(16),
                    flexShrink: 0,
                    borderRadius: "50%",
                    backgroundColor: colors[index],
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    flex: 1,
                    color: props.palette.muted,
                    fontSize: scaled(30),
                    lineHeight: 1.15,
                  }}
                >
                  {truncateCardText(segment.label, 16)}
                </div>
                <div style={{ display: "flex", color: props.palette.ink, fontSize: scaled(30), fontWeight: 700 }}>
                  {formatInt(segment.count)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", color: props.palette.muted, fontSize: scaled(30) }}>{props.empty}</div>
        )}
        {props.alignment === "right" ? (
          <img src={dataUri} alt="" width={size} height={size} style={{ display: "flex", width: size, height: size }} />
        ) : null}
      </div>
    </div>
  );
}

export function renderPersonaCard(data: PersonaCardData): VNode {
  const t = {
    inputTokens: localizer(data.locale, "commands.stats.infographic.input_tokens"),
    outputTokens: localizer(data.locale, "commands.stats.infographic.output_tokens"),
    totalSpent: localizer(data.locale, "commands.stats.infographic.total_spent"),
    memories: localizer(data.locale, "commands.stats.infographic.total_memories_owned"),
    conditioning: localizer(data.locale, "commands.stats.infographic.rewards_punishments_made"),
    emojis: localizer(data.locale, "commands.stats.infographic.favorite_emojis"),
    emotions: localizer(data.locale, "commands.stats.infographic.favorite_emotions"),
    tools: localizer(data.locale, "commands.stats.infographic.favorite_tools"),
    noData: localizer(data.locale, "commands.stats.infographic.no_data"),
    empty: localizer(data.locale, "commands.stats.empty"),
    footerBrand: localizer(data.locale, "commands.stats.infographic.persona_affinity_footer", {
      timeframe: timeframeLabel(data.locale, data.timeframe).toUpperCase(),
    }),
  };

  const hasData = data.totalTriggers > 0;
  const palette = data.palette ?? DEFAULT_PERSONAL_CARD_PALETTE;
  const userPalette = data.userPalette ?? palette;
  return (
    <div
      style={{
        display: "flex",
        width: CARD_W,
        height: getPersonaCardHeight(data),
        boxSizing: "border-box",
        overflow: "hidden",
        flexDirection: "column",
        paddingTop: scaled(46),
        paddingRight: scaled(66),
        paddingBottom: scaled(40),
        paddingLeft: scaled(66),
        backgroundColor: palette.background,
        color: palette.ink,
        fontFamily: CARD_THEME.fontFamily,
      }}
    >
      <div
        style={{
          display: "flex",
          width: "100%",
          minHeight: scaled(466),
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          paddingBottom: scaled(28),
          borderBottom: `${scaled(2)}px solid ${palette.accent}`,
        }}
      >
        <PersonaAvatarStack
          username={data.username}
          userAvatarDataUri={data.userAvatarDataUri}
          personaName={data.personaName}
          personaAvatarDataUri={data.personaAvatarDataUri}
          palette={palette}
        />
        <div
          style={{ display: "flex", marginTop: scaled(18), color: palette.ink, fontSize: scaled(48), fontWeight: 700 }}
        >
          {`${truncateCardText(data.username, 16)} X ${truncateCardText(data.personaName, 16)}`}
        </div>
      </div>
      {hasData ? (
        <>
          <div
            style={{
              display: "flex",
              width: "100%",
              paddingTop: scaled(26),
              paddingBottom: scaled(26),
              borderBottom: `${scaled(1)}px solid ${palette.border}`,
            }}
          >
            <PersonaTokenMetric label={t.inputTokens} value={formatInt(data.inputTokens)} palette={palette} />
            <PersonaTokenMetric
              label={t.outputTokens}
              value={formatInt(data.outputTokens)}
              palette={palette}
              bordered
            />
            <PersonaTokenMetric
              label={t.totalSpent}
              value={formatCost(data.estimatedCost)}
              palette={palette}
              bordered
            />
          </div>
          <div style={{ display: "flex", width: "100%", flexDirection: "column", paddingTop: scaled(8) }}>
            {data.memoryCount !== null ? (
              <PersonaDetailRow label={t.memories} palette={palette}>
                <div style={{ display: "flex", color: palette.ink, fontSize: scaled(42), fontWeight: 700 }}>
                  {formatInt(data.memoryCount)}
                </div>
              </PersonaDetailRow>
            ) : null}
            <PersonaDetailRow label={t.conditioning} palette={palette}>
              <div style={{ display: "flex", color: palette.ink, fontSize: scaled(42), fontWeight: 700 }}>
                {`${formatInt(data.conditioning.rewards)} / ${formatInt(data.conditioning.punishments)}`}
              </div>
            </PersonaDetailRow>
            <PersonaDetailRow label={t.emojis} palette={palette}>
              <PersonaEmojiList emojis={data.favoriteEmojis} empty={t.empty} palette={palette} />
            </PersonaDetailRow>
          </div>
          <div style={{ display: "flex", width: "100%", height: scaled(54), flexShrink: 0 }} />
          <div style={{ display: "flex", width: "100%" }}>
            <PersonaBreakdownChart
              title={t.emotions}
              segments={data.favoriteEmotions}
              empty={t.empty}
              palette={palette}
              alignment="left"
            />
          </div>
          <div style={{ display: "flex", width: "100%", height: scaled(48), flexShrink: 0 }} />
          <div style={{ display: "flex", width: "100%" }}>
            <PersonaBreakdownChart
              title={t.tools}
              segments={data.favoriteTools}
              empty={t.empty}
              palette={userPalette}
              alignment="right"
            />
          </div>
        </>
      ) : (
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center" }}>
          <div style={{ display: "flex", color: palette.muted, fontSize: scaled(36) }}>{t.noData}</div>
        </div>
      )}
      <div style={{ display: "flex", flex: 1, minHeight: scaled(20) }} />
      <div
        style={{
          display: "flex",
          width: "100%",
          marginTop: scaled(24),
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            display: "flex",
            width: scaled(86),
            height: scaled(86),
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {data.tomoriconDataUri ? (
            <img
              src={data.tomoriconDataUri}
              alt=""
              width={scaled(80)}
              height={scaled(80)}
              style={{ display: "flex", width: scaled(80), height: scaled(80), objectFit: "contain" }}
            />
          ) : null}
        </div>
        <div
          style={{
            display: "flex",
            color: palette.ink,
            fontSize: scaled(34),
            fontWeight: 700,
            letterSpacing: scaled(1),
          }}
        >
          {t.footerBrand}
        </div>
      </div>
    </div>
  );
}

/**
 * One persona's vertical-bar entry, ranked by total tokens (highest = leftmost).
 * `accent` is sampled from the persona avatar in the gatherer and tints the bar.
 */
export interface ServerPersonaBar extends PersonIcon {
  rank: number;
  totalTokens: number;
  estimatedCost: number;
  accent: string;
}

/** One member's horizontal-bar entry, ranked by triggers; `accent` tints the bar. */
export interface ServerMemberBar extends PersonIcon {
  rank: number;
  triggers: number;
  accent: string;
}

/** One model's horizontal-bar entry, ranked by total tokens processed (no icon). */
export interface ServerModelBar {
  name: string;
  totalTokens: number;
  estimatedCost: number;
}

export interface ServerCardData {
  locale: string;
  timeframe: Timeframe;
  serverName: string;
  serverIconDataUri: string | null;
  tomoriconDataUri: string | null;
  palette: PersonalCardPalette;
  topPersonas: ServerPersonaBar[];
  topMembers: ServerMemberBar[];
  topModels: ServerModelBar[];
  totalTokens: number;
  estimatedCost: number;
  totalTriggers: number;
  totalPersonas: number;
  serverUserCount: number;
}

/** Server card padding; the shorter top inset keeps the header visually anchored. */
const SERVER_SIDE_PAD = scaled(66);
const SERVER_TOP_PAD = scaled(42);
const SERVER_BOTTOM_PAD = scaled(66);
const SERVER_LOWER_W = CARD_W - SERVER_SIDE_PAD * 2;
/** Pixels reserved at an avatar-tipped bar's end for its avatar + name label. */
const SERVER_BAR_TIP_RESERVE = scaled(360);
const SERVER_BAR_TRACK_W = SERVER_LOWER_W - SERVER_BAR_TIP_RESERVE;
/** Model bars need no avatar, so their tip reserve (name only) is smaller. */
const SERVER_MODEL_TRACK_W = SERVER_LOWER_W - scaled(280);
const SERVER_BAR_TEXT_PAD = scaled(24);
const SERVER_BAR_TEXT_FONT_SIZE = scaled(27);

// Fixed section heights, summed by getServerCardHeight so the content-aware
// card height stays exact (satori clips/pads to the height we hand it).
const SERVER_HEADER_H = scaled(112);
const SERVER_BLOCK_TITLE_H = scaled(74);
const SERVER_BAR_ROW_H = scaled(98);
const SERVER_TOTALS_H = scaled(150);
const SERVER_FOOTER_H = scaled(112);

/**
 * Picks black or white text for legibility on a solid `hex` fill using the WCAG
 * relative-luminance threshold. Pure + synchronous so it stays renderer-safe.
 */
function readableInkOn(hex: string): string {
  const clean = hex.replace("#", "");
  if (clean.length < 6) return "#ffffff";
  const toLinear = (channel: number): number => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * toLinear(Number.parseInt(clean.slice(0, 2), 16)) +
    0.7152 * toLinear(Number.parseInt(clean.slice(2, 4), 16)) +
    0.0722 * toLinear(Number.parseInt(clean.slice(4, 6), 16));
  return luminance > 0.5 ? "#1d1410" : "#ffffff";
}

/** Circular avatar whose ring uses a per-entry `accent` over the card palette. */
function AccentAvatar(
  props: Record<string, unknown> & {
    name: string;
    dataUri: string | null;
    size: number;
    accent: string;
    palette: PersonalCardPalette;
  },
): VNode {
  const initials = props.name.trim().slice(0, 1).toUpperCase() || "?";
  return (
    <div
      style={{
        display: "flex",
        width: props.size,
        height: props.size,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        borderRadius: "50%",
        border: `${scaled(3)}px solid ${props.accent}`,
        backgroundColor: props.palette.surface,
        color: props.palette.ink,
        fontSize: Math.max(scaled(22), Math.round(props.size * 0.4)),
        fontWeight: 700,
      }}
    >
      {props.dataUri ? (
        <img
          src={props.dataUri}
          alt=""
          width={props.size}
          height={props.size}
          style={{ display: "flex", width: props.size, height: props.size, objectFit: "cover" }}
        />
      ) : (
        initials
      )}
    </div>
  );
}

/** Avatar + name shown at the tip of an avatar-bearing bar (personas, members). */
function ServerBarTip(
  props: Record<string, unknown> & {
    name: string;
    dataUri: string | null;
    accent: string;
    palette: PersonalCardPalette;
  },
): VNode {
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", marginLeft: -scaled(20) }}>
      <AccentAvatar
        name={props.name}
        dataUri={props.dataUri}
        size={scaled(78)}
        accent={props.accent}
        palette={props.palette}
      />
      <div
        style={{
          display: "flex",
          marginLeft: scaled(16),
          color: props.palette.ink,
          fontSize: scaled(28),
          fontWeight: 700,
        }}
      >
        {truncateCardText(props.name, 14)}
      </div>
    </div>
  );
}

/**
 * Satori exposes no text-measurement API, so use conservative Noto Sans JP
 * glyph-width estimates when deciding whether an in-bar label will fit.
 */
function estimateServerBarTextWidth(text: string): number {
  const emWidth = Array.from(text).reduce((total, character) => {
    if (/\s/u.test(character)) return total + 0.35;
    if (/[.,:;|]/u.test(character)) return total + 0.35;
    if (/[ilI1]/u.test(character)) return total + 0.42;
    if (/[MW@#%]/u.test(character)) return total + 0.9;
    if ((character.codePointAt(0) ?? 0) > 0xff) return total + 1;
    return total + 0.62;
  }, 0);
  return Math.ceil(emWidth * SERVER_BAR_TEXT_FONT_SIZE);
}

export interface ServerBarLayout {
  width: number;
  insideText: string;
}

/**
 * Preserves the leader-relative width of each row. A row only grows past that
 * proportional width when its compact label would not fit; the long label is
 * used whenever the proportional bar has enough room for it.
 */
export function getServerBarLayout(
  fraction: number,
  trackWidth: number,
  fullText: string,
  compactText: string,
): ServerBarLayout {
  const clampedFraction = Math.min(1, Math.max(0, fraction));
  const proportionalWidth = Math.round(trackWidth * clampedFraction);
  const fullWidth = estimateServerBarTextWidth(fullText) + SERVER_BAR_TEXT_PAD * 2;
  if (proportionalWidth >= fullWidth) {
    return { width: proportionalWidth, insideText: fullText };
  }

  const compactWidth = estimateServerBarTextWidth(compactText) + SERVER_BAR_TEXT_PAD * 2;
  return {
    width: Math.min(trackWidth, Math.max(proportionalWidth, compactWidth)),
    insideText: compactText,
  };
}

/**
 * One horizontal bar: a fill sized as a share of the leader, with a compact
 * in-bar label only when the full label cannot fit.
 */
function ServerBarRow(
  props: Record<string, unknown> & {
    fillColor: string;
    fullInsideText: string;
    compactInsideText: string;
    fraction: number;
    trackWidth?: number;
    tip?: unknown;
  },
): VNode {
  const trackWidth = props.trackWidth ?? SERVER_BAR_TRACK_W;
  const { width: barWidth, insideText } = getServerBarLayout(
    props.fraction,
    trackWidth,
    props.fullInsideText,
    props.compactInsideText,
  );
  const ink = readableInkOn(props.fillColor);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        width: "100%",
        alignItems: "center",
        paddingTop: scaled(10),
        paddingBottom: scaled(10),
      }}
    >
      <div
        style={{
          display: "flex",
          width: barWidth,
          height: scaled(78),
          flexShrink: 0,
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: scaled(24),
          paddingRight: SERVER_BAR_TEXT_PAD,
          borderRadius: scaled(16),
          backgroundColor: props.fillColor,
        }}
      >
        <div
          style={{
            display: "flex",
            color: ink,
            fontSize: SERVER_BAR_TEXT_FONT_SIZE,
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          {insideText}
        </div>
      </div>
      {props.tip as VNode}
    </div>
  );
}

/** Title row above each bar block, tinted to the card accent (natural height). */
function ServerBlockTitle(props: Record<string, unknown> & { title: string; palette: PersonalCardPalette }): VNode {
  return (
    <div
      style={{
        display: "flex",
        paddingTop: scaled(22),
        paddingBottom: scaled(10),
        color: props.palette.accent,
        fontSize: scaled(34),
        fontWeight: 700,
      }}
    >
      {props.title}
    </div>
  );
}

/** Clamps a block's row count to [1, max]; the floor reserves a row for "empty". */
function serverBlockRowCount(length: number, max: number): number {
  return Math.max(1, Math.min(length, max));
}

/**
 * Content-aware height: the card grows with its actual persona/member/model rows
 * (no fixed hero), so small servers stay compact and full ones never clip. The
 * sum reuses the same section-height constants the renderer pins, keeping it exact.
 */
export function getServerCardHeight(data: ServerCardData): number {
  if (data.totalTriggers === 0) return scaled(980);
  const rows =
    serverBlockRowCount(data.topPersonas.length, 5) +
    serverBlockRowCount(data.topMembers.length, 3) +
    serverBlockRowCount(data.topModels.length, 3);
  return (
    SERVER_TOP_PAD +
    SERVER_BOTTOM_PAD +
    SERVER_HEADER_H +
    SERVER_BLOCK_TITLE_H * 3 +
    rows * SERVER_BAR_ROW_H +
    SERVER_TOTALS_H +
    SERVER_FOOTER_H
  );
}

export function renderServerCard(data: ServerCardData): VNode {
  const t = {
    title: localizer(data.locale, "commands.stats.infographic.server_title"),
    topPersonas: localizer(data.locale, "commands.stats.infographic.top_personas"),
    mostActiveMembers: localizer(data.locale, "commands.stats.infographic.most_active_members"),
    topModels: localizer(data.locale, "commands.stats.infographic.top_models"),
    totalTokens: localizer(data.locale, "commands.stats.infographic.total_server_tokens"),
    totalSpent: localizer(data.locale, "commands.stats.infographic.total_server_spend"),
    triggerLabel: localizer(data.locale, "commands.stats.units.messages_to_me"),
    footerBrand: localizer(data.locale, "commands.stats.infographic.server_leaderboard_footer", {
      timeframe: timeframeLabel(data.locale, data.timeframe).toUpperCase(),
    }),
    subtitle: localizer(data.locale, "commands.stats.infographic.server_subtitle", {
      personas: data.totalPersonas,
      members: data.serverUserCount,
    }),
    noData: localizer(data.locale, "commands.stats.infographic.no_data"),
    empty: localizer(data.locale, "commands.stats.empty"),
  };

  const hasData = data.totalTriggers > 0;
  const palette = data.palette ?? DEFAULT_PERSONAL_CARD_PALETTE;
  const personas = data.topPersonas.slice(0, 5);
  const members = data.topMembers.slice(0, 3);
  const models = data.topModels.slice(0, 3);
  const maxPersonaTokens = Math.max(1, ...personas.map((entry) => entry.totalTokens));
  const maxTriggers = Math.max(1, ...members.map((entry) => entry.triggers));
  const maxModelTokens = Math.max(1, ...models.map((entry) => entry.totalTokens));
  const tokenCostText = (totalTokens: number, cost: number): string =>
    localizer(data.locale, "commands.stats.infographic.model_tokens_cost", {
      count: formatInt(totalTokens),
      cost: formatCost(cost),
    });
  const compactTokenCostText = (totalTokens: number, cost: number): string =>
    localizer(data.locale, "commands.stats.infographic.model_tokens_cost_compact", {
      count: formatInt(totalTokens),
      cost: formatCost(cost),
    });

  return (
    <div
      style={{
        display: "flex",
        width: CARD_W,
        height: getServerCardHeight(data),
        boxSizing: "border-box",
        overflow: "hidden",
        flexDirection: "column",
        paddingTop: SERVER_TOP_PAD,
        paddingRight: SERVER_SIDE_PAD,
        paddingBottom: SERVER_BOTTOM_PAD,
        paddingLeft: SERVER_SIDE_PAD,
        backgroundColor: palette.background,
        color: palette.ink,
        fontFamily: CARD_THEME.fontFamily,
      }}
    >
      {/* 1. Header row: server icon + name + timeframe subtitle. */}
      <div
        style={{
          display: "flex",
          width: "100%",
          height: SERVER_HEADER_H,
          flexShrink: 0,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <AccentAvatar
          name={data.serverName}
          dataUri={data.serverIconDataUri}
          size={scaled(112)}
          accent={palette.accent}
          palette={palette}
        />
        <div style={{ display: "flex", flexDirection: "column", marginLeft: scaled(26), flex: 1 }}>
          <div style={{ display: "flex", color: palette.ink, fontSize: scaled(56), fontWeight: 700, lineHeight: 1.05 }}>
            {truncateCardText(data.serverName, 22)}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: scaled(6),
              color: palette.accent,
              fontSize: scaled(28),
              fontWeight: 700,
            }}
          >
            {t.subtitle}
          </div>
        </div>
      </div>

      {hasData ? (
        <>
          {/* 2. Top Personas: horizontal bars (tokens | cost inside, avatar + name at tip). */}
          <ServerBlockTitle title={t.topPersonas} palette={palette} />
          {personas.length > 0 ? (
            personas.map((entry) => (
              <ServerBarRow
                key={`${entry.rank}-${entry.name}`}
                fillColor={entry.accent}
                fullInsideText={tokenCostText(entry.totalTokens, entry.estimatedCost)}
                compactInsideText={compactTokenCostText(entry.totalTokens, entry.estimatedCost)}
                fraction={entry.totalTokens / maxPersonaTokens}
                tip={
                  <ServerBarTip
                    name={entry.name}
                    dataUri={entry.avatarDataUri}
                    accent={entry.accent}
                    palette={palette}
                  />
                }
              />
            ))
          ) : (
            <div style={{ display: "flex", color: palette.muted, fontSize: scaled(28) }}>{t.empty}</div>
          )}

          {/* 3. Most Active Members: triggers inside, avatar + name at tip. */}
          <ServerBlockTitle title={t.mostActiveMembers} palette={palette} />
          {members.length > 0 ? (
            members.map((entry) => (
              <ServerBarRow
                key={`${entry.rank}-${entry.name}`}
                fillColor={entry.accent}
                fullInsideText={`${formatInt(entry.triggers)} ${t.triggerLabel}`}
                compactInsideText={formatInt(entry.triggers)}
                fraction={entry.triggers / maxTriggers}
                tip={
                  <ServerBarTip
                    name={entry.name}
                    dataUri={entry.avatarDataUri}
                    accent={entry.accent}
                    palette={palette}
                  />
                }
              />
            ))
          ) : (
            <div style={{ display: "flex", color: palette.muted, fontSize: scaled(28) }}>{t.empty}</div>
          )}

          {/* 4. Top Models: tokens | cost inside, model name at tip (no avatar). */}
          <ServerBlockTitle title={t.topModels} palette={palette} />
          {models.length > 0 ? (
            models.map((entry) => (
              <ServerBarRow
                key={entry.name}
                fillColor={palette.accentSecondary}
                fullInsideText={tokenCostText(entry.totalTokens, entry.estimatedCost)}
                compactInsideText={compactTokenCostText(entry.totalTokens, entry.estimatedCost)}
                fraction={entry.totalTokens / maxModelTokens}
                trackWidth={SERVER_MODEL_TRACK_W}
                tip={
                  <div
                    style={{
                      display: "flex",
                      marginLeft: scaled(18),
                      color: palette.ink,
                      fontSize: scaled(28),
                      fontWeight: 700,
                    }}
                  >
                    {truncateCardText(entry.name, 22)}
                  </div>
                }
              />
            ))
          ) : (
            <div style={{ display: "flex", color: palette.muted, fontSize: scaled(28) }}>{t.empty}</div>
          )}

          {/* Spacer pushes the server totals + signature to the card bottom. */}
          <div style={{ display: "flex", flex: 1, minHeight: scaled(16) }} />

          <div
            style={{
              display: "flex",
              width: "100%",
              paddingTop: scaled(26),
              flexDirection: "row",
              justifyContent: "space-between",
              borderTop: `${scaled(2)}px solid ${palette.accent}`,
            }}
          >
            <PersonalTotal label={t.totalTokens} value={formatInt(data.totalTokens)} palette={palette} />
            <PersonalTotal label={t.totalSpent} value={formatCost(data.estimatedCost)} palette={palette} />
          </div>
        </>
      ) : (
        <div
          style={{ display: "flex", flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "center" }}
        >
          <div style={{ display: "flex", color: palette.muted, fontSize: scaled(40) }}>{t.noData}</div>
        </div>
      )}

      <div
        style={{
          display: "flex",
          width: "100%",
          marginTop: scaled(24),
          flexShrink: 0,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            display: "flex",
            width: scaled(86),
            height: scaled(86),
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {data.tomoriconDataUri ? (
            <img
              src={data.tomoriconDataUri}
              alt=""
              width={scaled(80)}
              height={scaled(80)}
              style={{ display: "flex", width: scaled(80), height: scaled(80), objectFit: "contain" }}
            />
          ) : null}
        </div>
        <div
          style={{
            display: "flex",
            color: palette.ink,
            fontSize: scaled(34),
            fontWeight: 700,
            letterSpacing: scaled(1),
          }}
        >
          {t.footerBrand}
        </div>
      </div>
    </div>
  );
}
