import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatNu } from "@/lib/format";
import { INK, Letterhead, MUTED, RULE, base } from "./letterhead";
import type { PayslipModel, PayslipRow } from "./model";

// The payslip on paper: A4, one column, in the order the pay was worked out, take-home first and
// largest.

const s = StyleSheet.create({
  title: { fontSize: 13, fontWeight: 600 },
  who: { fontSize: 10, color: MUTED, marginTop: 2 },
  imported: { fontSize: 9, color: MUTED, marginTop: 6 },
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
  return (
    <Document title={`${model.title}, ${model.person.name}`} author={model.company.name} creator="DashTeam" producer="DashTeam" language="en">
      <Page size="A4" style={base.page}>
        <Letterhead company={model.company} />

        <Text style={s.title}>{model.title}</Text>
        <Text style={s.who}>{[model.person.name, model.person.employmentType, model.person.tpn].join(" · ")}</Text>
        {model.imported ? <Text style={s.imported}>Imported record. Figures as kept before DashTeam.</Text> : null}

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
          {model.reference} · {model.imported ? "Brought into DashTeam" : "Issued"} {model.issuedOn}
        </Text>
      </Page>
    </Document>
  );
}
