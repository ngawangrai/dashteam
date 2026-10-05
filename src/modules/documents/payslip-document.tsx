import { existsSync } from "node:fs";
import { join } from "node:path";
import { Document, Font, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatNu } from "@/lib/format";
import type { PayslipModel, PayslipRow } from "./model";

// The payslip on paper: A4, one column, in the order the pay was worked out, take-home first and
// largest. Black on white so it prints cleanly; hierarchy from size and weight, never colour.
// Inter is embedded because a PDF can't use the reader's system font.

const ASSETS = join(process.cwd(), "src/modules/documents");
const LOGO = join(ASSETS, "assets/logo.png");

Font.register({
  family: "Inter",
  fonts: [
    { src: join(ASSETS, "fonts/Inter-Regular.ttf"), fontWeight: 400 },
    { src: join(ASSETS, "fonts/Inter-SemiBold.ttf"), fontWeight: 600 },
    { src: join(ASSETS, "fonts/Inter-Bold.ttf"), fontWeight: 700 },
  ],
});
// Keep words whole: hyphenating names and notes reads badly on a payslip.
Font.registerHyphenationCallback((word) => [word]);

const INK = "#1c1c1e";
const MUTED = "#6c6c70";
const RULE = "#c6c6c8";

const s = StyleSheet.create({
  page: { fontFamily: "Inter", fontSize: 10, color: INK, paddingVertical: 48, paddingHorizontal: 56, lineHeight: 1.4 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  company: { fontSize: 15, fontWeight: 700 },
  address: { fontSize: 9, color: MUTED },
  logo: { width: 72, height: 36, objectFit: "contain" },
  rule: { borderBottomWidth: 0.5, borderBottomColor: RULE, marginVertical: 16 },
  title: { fontSize: 13, fontWeight: 600 },
  who: { fontSize: 10, color: MUTED, marginTop: 2 },
  takeHomeLabel: { fontSize: 10, color: MUTED, marginTop: 20 },
  takeHome: { fontSize: 30, fontWeight: 700, letterSpacing: -0.4, marginBottom: 8 },
  section: { fontSize: 11, fontWeight: 600, marginTop: 20, marginBottom: 2 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: RULE },
  rowLabel: { flexShrink: 1, paddingRight: 16 },
  detail: { fontSize: 9, color: MUTED },
  amount: { textAlign: "right" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 },
  total: { fontWeight: 600 },
  finalRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: INK },
  final: { fontSize: 12, fontWeight: 700 },
  footer: { fontSize: 9, color: MUTED, marginTop: 24 },
});

function Rows({ rows }: { rows: PayslipRow[] }) {
  return rows.map((row, i) => (
    <View key={`${row.label}-${i}`} style={s.row} wrap={false}>
      {/* The note sits on the same line, so a busy month still fits one page. */}
      <Text style={s.rowLabel}>
        {row.label}
        {row.detail ? <Text style={s.detail}>{`  ·  ${row.detail}`}</Text> : null}
      </Text>
      <Text style={s.amount}>{formatNu(row.amount)}</Text>
    </View>
  ));
}

export function PayslipDocument({ model }: { model: PayslipModel }) {
  const showLogo = model.company.showLogo && existsSync(LOGO);
  return (
    <Document title={`${model.title}, ${model.person.name}`} author={model.company.name} creator="DashTeam" producer="DashTeam" language="en">
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.company}>{model.company.name}</Text>
            {model.company.addressLines.map((line) => (
              <Text key={line} style={s.address}>
                {line}
              </Text>
            ))}
          </View>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image has no alt; the company name is the text beside it. */}
          {showLogo ? <Image src={LOGO} style={s.logo} /> : null}
        </View>
        <View style={s.rule} />

        <Text style={s.title}>{model.title}</Text>
        <Text style={s.who}>{[model.person.name, model.person.employmentType, model.person.tpn].join(" · ")}</Text>

        <Text style={s.takeHomeLabel}>Take-home</Text>
        <Text style={s.takeHome}>{formatNu(model.takeHome)}</Text>

        <Text style={s.section}>Earnings</Text>
        <Rows rows={model.earnings} />
        <View style={s.totalRow}>
          <Text style={s.total}>Gross pay</Text>
          <Text style={[s.total, s.amount]}>{formatNu(model.gross)}</Text>
        </View>

        <Text style={s.section}>Deductions</Text>
        <Rows rows={model.deductions} />
        <View style={s.totalRow}>
          <Text style={s.total}>Total deductions</Text>
          <Text style={[s.total, s.amount]}>{formatNu(model.totalDeductions)}</Text>
        </View>

        <View style={s.finalRow} wrap={false}>
          <Text style={s.final}>Take-home</Text>
          <Text style={[s.final, s.amount]}>{formatNu(model.takeHome)}</Text>
        </View>

        <Text style={s.footer}>
          {model.reference} · Issued {model.issuedOn}
        </Text>
      </Page>
    </Document>
  );
}
