import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatNu } from "@/lib/format";
import { INK, Letterhead, MUTED, RULE, base } from "./letterhead";
import type { StatementModel } from "./statement-model";

// The pay statement on paper: who and when, take-home for the period first and largest, then a line
// per month and the totals. The column headings repeat if a long range runs onto a second page.

const s = StyleSheet.create({
  title: { fontSize: 13, fontWeight: 600 },
  who: { fontSize: 10, color: MUTED, marginTop: 2 },
  takeHomeLabel: { fontSize: 10, color: MUTED, marginTop: 20 },
  takeHome: { fontSize: 30, fontWeight: 700, letterSpacing: -0.4, lineHeight: 1.2 },
  row: { flexDirection: "row", paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: RULE },
  head: { flexDirection: "row", marginTop: 24, paddingBottom: 4, borderBottomWidth: 0.5, borderBottomColor: INK },
  headText: { fontSize: 9, color: MUTED },
  month: { flex: 1.4, paddingRight: 8 },
  money: { flex: 1, textAlign: "right" },
  caption: { fontSize: 8, color: MUTED },
  notPaid: { flex: 3, textAlign: "right", color: MUTED },
  totalRow: { flexDirection: "row", paddingTop: 8, marginTop: 2, borderTopWidth: 1, borderTopColor: INK },
  total: { fontWeight: 700 },
  note: { fontSize: 9, color: MUTED, marginTop: 20 },
  footer: { fontSize: 9, color: MUTED, marginTop: 8 },
});

export function StatementDocument({ model }: { model: StatementModel }) {
  return (
    <Document title={`${model.title}, ${model.person.name}, ${model.period}`} author={model.company.name} creator="DashTeam" producer="DashTeam" language="en">
      <Page size="A4" style={base.page}>
        <Letterhead company={model.company} />

        <Text style={s.title}>{model.title}</Text>
        <Text style={s.who}>{[model.person.name, model.person.employmentType, model.person.tpn].filter(Boolean).join(" · ")}</Text>
        <Text style={s.who}>{model.period}</Text>

        <Text style={s.takeHomeLabel}>{model.paidMonths === 1 ? "Take-home for 1 month" : `Take-home for ${model.paidMonths} months`}</Text>
        <Text style={s.takeHome}>{formatNu(model.totals.takeHome)}</Text>

        <View style={s.head} fixed>
          <Text style={[s.headText, s.month]}>Month</Text>
          <Text style={[s.headText, s.money]}>Gross</Text>
          <Text style={[s.headText, s.money]}>Deductions</Text>
          <Text style={[s.headText, s.money]}>Take-home</Text>
        </View>
        {model.lines.map((line) => (
          <View key={line.monthName} style={s.row} wrap={false}>
            <View style={s.month}>
              <Text>{line.monthName}</Text>
              {line.kind === "paid" && line.imported ? <Text style={s.caption}>Imported</Text> : null}
            </View>
            {line.kind === "paid" ? (
              <>
                <Text style={s.money}>{formatNu(line.gross)}</Text>
                <Text style={s.money}>{formatNu(line.deductions)}</Text>
                <Text style={s.money}>{formatNu(line.takeHome)}</Text>
              </>
            ) : (
              <Text style={s.notPaid}>Not paid</Text>
            )}
          </View>
        ))}
        <View style={s.totalRow} wrap={false}>
          <Text style={[s.total, s.month]}>Total</Text>
          <Text style={[s.total, s.money]}>{formatNu(model.totals.gross)}</Text>
          <Text style={[s.total, s.money]}>{formatNu(model.totals.deductions)}</Text>
          <Text style={[s.total, s.money]}>{formatNu(model.totals.takeHome)}</Text>
        </View>

        <View wrap={false}>
          <Text style={s.note}>Deductions are TDS, health contribution and any recoveries.</Text>
          {model.anyImported ? <Text style={s.caption}>Months marked Imported were brought in from records kept before DashTeam.</Text> : null}
          <Text style={s.footer}>
            {model.reference} · Issued {model.issuedOn}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
