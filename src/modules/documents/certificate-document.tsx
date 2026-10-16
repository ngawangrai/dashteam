import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { CertificateModel } from "./certificate-model";
import { Letterhead, MUTED, RULE, base } from "./letterhead";

// The salary certificate on paper: a one-page company letter. Reference and date, who it's to, the
// subject, three short paragraphs, then the signature block, the way a printed letter is laid out.

export type SignatureImage = { data: Buffer; format: "png" | "jpg" };

const s = StyleSheet.create({
  page: { fontSize: 11, lineHeight: 1.6 },
  meta: { flexDirection: "row", justifyContent: "space-between", fontSize: 10 },
  to: { marginTop: 28 },
  subject: { fontSize: 12, fontWeight: 600, marginTop: 24, marginBottom: 4 },
  paragraph: { marginTop: 12 },
  signOff: { marginTop: 36 },
  signature: { width: 140, height: 56, objectFit: "contain", marginTop: 8 },
  noSignature: { height: 56 },
  signatory: { fontWeight: 600 },
  footer: { position: "absolute", left: 56, right: 56, bottom: 40, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: RULE, fontSize: 8, color: MUTED },
});

export function CertificateDocument({ model, signature }: { model: CertificateModel; signature: SignatureImage | null }) {
  return (
    <Document title={`${model.subject}, ${model.person.name}`} author={model.company.name} creator="DashTeam" producer="DashTeam" language="en">
      <Page size="A4" style={[base.page, s.page]}>
        <Letterhead company={model.company} />

        <View style={s.meta}>
          <Text>Ref: {model.reference}</Text>
          <Text>{model.issuedOn}</Text>
        </View>

        <View style={s.to}>
          {model.addressee[0] === "To whom it may concern" ? null : <Text>To</Text>}
          {model.addressee.map((line) => (
            <Text key={line}>{line}</Text>
          ))}
        </View>

        <Text style={s.subject}>{model.subject}</Text>
        {model.paragraphs.map((paragraph) => (
          <Text key={paragraph} style={s.paragraph}>
            {paragraph}
          </Text>
        ))}

        <View style={s.signOff} wrap={false}>
          <Text>{model.signOff}</Text>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image has no alt; the signatory's name follows it. */}
          {signature ? <Image src={signature} style={s.signature} /> : <View style={s.noSignature} />}
          <Text style={s.signatory}>{model.signatory.name}</Text>
          <Text>{model.signatory.title}</Text>
        </View>

        <Text style={s.footer} fixed>
          {model.reference} · Issued through DashTeam on {model.issuedOn}
        </Text>
      </Page>
    </Document>
  );
}
