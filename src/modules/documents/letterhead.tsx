import { existsSync } from "node:fs";
import { join } from "node:path";
import { Font, Image, StyleSheet, Text, View } from "@react-pdf/renderer";

// What every DashTeam document shares on paper: Inter, the ink colours, and Xceed's letterhead.
// Black on white so it prints cleanly; hierarchy from size and weight, never colour. Inter is
// embedded because a PDF can't use the reader's system font.

const ASSETS = join(process.cwd(), "src/modules/documents");
const LOGO = join(ASSETS, "assets/logo.png");

/**
 * Fresh fonts for each document. react-pdf keeps the parsed font between renders, and a document laid
 * out with a font another document used first can break words in the wrong place ("o f"). Loading
 * them anew costs a few milliseconds and makes every document lay out the same whatever came before.
 */
export function freshFonts(): void {
  // The registry object itself: dropping Inter from it leaves react-pdf's standard fonts in place.
  delete (Font.getRegisteredFonts() as Record<string, unknown>).Inter;
  Font.register({
    family: "Inter",
    fonts: [
      { src: join(ASSETS, "fonts/Inter-Regular.ttf"), fontWeight: 400 },
      { src: join(ASSETS, "fonts/Inter-SemiBold.ttf"), fontWeight: 600 },
      { src: join(ASSETS, "fonts/Inter-Bold.ttf"), fontWeight: 700 },
    ],
  });
  // Keep words whole: hyphenating names and notes reads badly on a document.
  Font.registerHyphenationCallback((word) => [word]);
}
freshFonts();

export const INK = "#1c1c1e";
export const MUTED = "#6c6c70";
export const RULE = "#c6c6c8";

export const base = StyleSheet.create({
  page: { fontFamily: "Inter", fontSize: 10, color: INK, paddingVertical: 48, paddingHorizontal: 56, lineHeight: 1.4 },
  rule: { borderBottomWidth: 0.5, borderBottomColor: RULE, marginVertical: 16 },
});

const s = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  company: { fontSize: 15, fontWeight: 700, marginBottom: 2 },
  address: { fontSize: 9, color: MUTED },
  logo: { width: 72, height: 36, objectFit: "contain" },
});

export type Company = { name: string; addressLines: string[]; showLogo: boolean };

export function Letterhead({ company }: { company: Company }) {
  const showLogo = company.showLogo && existsSync(LOGO);
  return (
    <>
      <View style={s.header}>
        <View>
          <Text style={s.company}>{company.name}</Text>
          {company.addressLines.map((line) => (
            <Text key={line} style={s.address}>
              {line}
            </Text>
          ))}
        </View>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image has no alt; the company name is the text beside it. */}
        {showLogo ? <Image src={LOGO} style={s.logo} /> : null}
      </View>
      <View style={base.rule} />
    </>
  );
}
