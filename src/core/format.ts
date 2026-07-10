// d3-format + d3-time-format subsets (D3-parity campaign, cluster D1).
// Pure, isomorphic. Covers the specifiers the gallery scenes actually use:
//   format: [,][.N][~][d|f|%|s|e|g] with optional "+" sign prefix
//   utcFormat: %Y %m %d %e %H %M %S %a %A %b %B %-d %-m %j %U (UTC only —
//   deterministic renders never touch the local timezone)
// plus the UTC interval helpers the calendar scene needs.

// --- number formatting ---------------------------------------------------------

const SI_PREFIXES = ["y", "z", "a", "f", "p", "n", "µ", "m", "", "k", "M", "G", "T", "P", "E", "Z", "Y"];

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * d3.format(specifier) subset. Recognized: optional sign ("+"), optional
 * comma grouping (","), optional precision (".N"), optional trim ("~"),
 * type in d, f, %, s, e, g (default = f-ish general).
 */
export function format(specifier = ""): (v: number) => string {
  const m = /^([+\- ])?([,])?(?:\.(\d+))?(~)?([dfg%se])?$/.exec(specifier);
  if (!m) throw new Error(`format: unsupported specifier "${specifier}"`);
  const [, sign, comma, precStr, trim, type = ""] = m;
  const precision = precStr !== undefined ? +precStr : undefined;

  return (value: number): string => {
    if (value == null || Number.isNaN(value)) return "NaN";
    let v = value;
    let suffix = "";

    if (type === "%") {
      v = v * 100;
      suffix = "%";
    }

    let out: string;
    if (type === "d") {
      out = Math.round(Math.abs(v)).toString();
    } else if (type === "s") {
      // SI prefix: engineering exponent.
      const abs = Math.abs(v);
      const exp = abs === 0 ? 0 : Math.max(-24, Math.min(24, Math.floor(Math.log10(abs) / 3) * 3));
      const scaled = v / Math.pow(10, exp);
      const p = precision ?? 3;
      let str = scaled.toPrecision(p);
      if (trim || precStr === undefined) str = String(parseFloat(str));
      out = str.replace("-", "") ;
      suffix = SI_PREFIXES[exp / 3 + 8] + suffix;
    } else if (type === "e") {
      out = Math.abs(v).toExponential(precision ?? 6);
    } else if (type === "g") {
      let str = Math.abs(v).toPrecision(precision ?? 6);
      if (trim) str = String(parseFloat(str));
      out = str;
    } else {
      // f / % / default
      const p = precision ?? (type === "f" || type === "%" ? 6 : undefined);
      let str = p !== undefined ? Math.abs(v).toFixed(p) : String(Math.abs(v));
      if (trim && str.includes(".")) str = str.replace(/\.?0+$/, "");
      out = str;
    }

    if (comma) {
      const dot = out.indexOf(".");
      out = dot < 0 ? groupThousands(out) : groupThousands(out.slice(0, dot)) + out.slice(dot);
    }

    const neg = v < 0 && parseFloat(out) !== 0;
    const prefix = neg ? "-" : sign === "+" ? "+" : sign === " " ? " " : "";
    return prefix + out + suffix;
  };
}

/** Pick a sensible default axis specifier for [a, b] with ~count ticks —
 *  the role d3's precisionFixed plays in scale.tickFormat. */
export function formatSpecifierAuto(a: number, b: number, count: number): string {
  const step = Math.abs(b - a) / Math.max(1, count);
  if (step === 0 || !isFinite(step)) return "";
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) );
  return decimals > 0 ? `.${Math.min(20, decimals)}f` : Math.abs(b) >= 1e5 ? "~s" : "d";
}

// --- UTC date formatting ---------------------------------------------------------

const DAYS_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const pad2 = (n: number) => String(n).padStart(2, "0");

/** d3.utcFormat(specifier) subset (UTC only). `%-d`/`%-m` = unpadded. */
export function utcFormat(specifier: string): (date: Date | number) => string {
  return (input: Date | number): string => {
    const d = input instanceof Date ? input : new Date(input);
    return specifier.replace(/%(-?)([a-zA-Z%])/g, (_all, dash: string, code: string) => {
      switch (code) {
        case "Y": return String(d.getUTCFullYear());
        case "y": return pad2(d.getUTCFullYear() % 100);
        case "m": return dash ? String(d.getUTCMonth() + 1) : pad2(d.getUTCMonth() + 1);
        case "d": return dash ? String(d.getUTCDate()) : pad2(d.getUTCDate());
        case "e": return String(d.getUTCDate()).padStart(2, " ");
        case "H": return pad2(d.getUTCHours());
        case "M": return pad2(d.getUTCMinutes());
        case "S": return pad2(d.getUTCSeconds());
        case "a": return DAYS_ABBR[d.getUTCDay()];
        case "A": return DAYS_FULL[d.getUTCDay()];
        case "b": return MONTHS_ABBR[d.getUTCMonth()];
        case "B": return MONTHS_FULL[d.getUTCMonth()];
        case "j": {
          const start = Date.UTC(d.getUTCFullYear(), 0, 1);
          return String(Math.floor((+d - start) / 86400000) + 1).padStart(3, "0");
        }
        case "U": return pad2(utcSunday.count(utcYear.floor(d), d));
        case "%": return "%";
        default: return `%${dash}${code}`;
      }
    });
  };
}

// --- UTC intervals (calendar layout math) ------------------------------------------

export interface UtcInterval {
  floor(date: Date | number): Date;
  offset(date: Date | number, step?: number): Date;
  range(start: Date | number, stop: Date | number, step?: number): Date[];
  count(start: Date | number, end: Date | number): number;
  ceil(date: Date | number): Date;
}

function makeInterval(
  floor: (d: Date) => void,
  offset: (d: Date, step: number) => void,
  count: (start: Date, end: Date) => number,
): UtcInterval {
  const iv: UtcInterval = {
    floor(date) {
      const d = new Date(+date);
      floor(d);
      return d;
    },
    ceil(date) {
      const d = iv.floor(date);
      if (+d < +new Date(+date)) return iv.offset(d, 1);
      return d;
    },
    offset(date, step = 1) {
      const d = new Date(+date);
      offset(d, step);
      return d;
    },
    range(start, stop, step = 1) {
      const out: Date[] = [];
      let t = iv.ceil(start);
      while (+t < +new Date(+stop)) {
        out.push(new Date(+t));
        t = iv.offset(t, step);
      }
      return out;
    },
    count(start, end) {
      return count(iv.floor(start), iv.floor(end));
    },
  };
  return iv;
}

export const utcDay = makeInterval(
  (d) => d.setUTCHours(0, 0, 0, 0),
  (d, n) => d.setUTCDate(d.getUTCDate() + n),
  (a, b) => Math.round((+b - +a) / 86400000),
);

function weekday(dow: number): UtcInterval {
  return makeInterval(
    (d) => {
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 7 - dow) % 7));
    },
    (d, n) => d.setUTCDate(d.getUTCDate() + 7 * n),
    (a, b) => Math.round((+b - +a) / 604800000),
  );
}

export const utcSunday = weekday(0);
export const utcMonday = weekday(1);

export const utcMonth = makeInterval(
  (d) => { d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0); },
  (d, n) => d.setUTCMonth(d.getUTCMonth() + n),
  (a, b) => (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth(),
);

export const utcYear = makeInterval(
  (d) => { d.setUTCMonth(0, 1); d.setUTCHours(0, 0, 0, 0); },
  (d, n) => d.setUTCFullYear(d.getUTCFullYear() + n),
  (a, b) => b.getUTCFullYear() - a.getUTCFullYear(),
);
