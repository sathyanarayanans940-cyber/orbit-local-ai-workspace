import JSZip from 'jszip';

// SpreadsheetML package: typed values only; strings never become formulas.
const xml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
export async function generateSpreadsheet(spec) {
  const zip = new JSZip();
  const put = (path, body) => zip.file(path, declaration + body);
  put('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${spec.sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  put('_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  put('xl/workbook.xml', `<workbook xmlns="${ns}" xmlns:r="${rel}"><bookViews><workbookView/></bookViews><sheets>${spec.sheets.map((s,i)=>`<sheet name="${xml(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`);
  put('xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${spec.sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="${rel}/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="styles" Type="${rel}/styles" Target="styles.xml"/></Relationships>`);
  put('xl/styles.xml', `<styleSheet xmlns="${ns}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF217346"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  spec.sheets.forEach((sheet,i)=>{
    const values=[sheet.headers,...sheet.rows];
    const widths=sheet.headers.map((_,c)=>Math.min(48,Math.max(14,...values.map(row=>Math.min(48,String(row[c]??'').length+2)))));
    const rows=values.map((row,r)=>{
      const height=Math.min(300,Math.max(r===0?30:22,...row.map((v,c)=>String(v??'').split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil(line.length/(widths[c]-2))),0)*15+8)));
      return `<row r="${r+1}" ht="${height}" customHeight="1">${row.map((v,c)=>{
        const ref=`${String.fromCharCode(65+c)}${r+1}`, style=r===0?1:0;
        if(v===null) return `<c r="${ref}" s="${style}"/>`;
        if(typeof v==='number') return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
        if(typeof v==='boolean') return `<c r="${ref}" s="${style}" t="b"><v>${v?1:0}</v></c>`;
        return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
      }).join('')}</row>`;
    }).join('');
    const range=`A1:${String.fromCharCode(64+sheet.headers.length)}${values.length}`;
    put(`xl/worksheets/sheet${i+1}.xml`, `<worksheet xmlns="${ns}"><dimension ref="${range}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="22"/><cols>${widths.map((w,c)=>`<col min="${c+1}" max="${c+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows}</sheetData><autoFilter ref="${range}"/></worksheet>`);
  });
  return new Blob([await zip.generateAsync({type:'uint8array',compression:'DEFLATE'})],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
