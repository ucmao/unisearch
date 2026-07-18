import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';

export async function exportToExcel(contents: any[], filePath: string): Promise<void> {
  console.log(`[Excel] Exporting ${contents.length} contents to Excel: ${filePath}`);
  
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('内容抓取结果');

  // Columns definition
  sheet.columns = [
    { header: '任务ID', key: 'run_id', width: 20 },
    { header: '来源平台', key: 'platform_label', width: 12 },
    { header: '检索关键词', key: 'keyword', width: 15 },
    { header: '内容ID', key: 'content_id', width: 18 },
    { header: '标题', key: 'title', width: 35 },
    { header: '博主ID', key: 'creator_id', width: 15 },
    { header: '博主昵称', key: 'creator_name', width: 18 },
    { header: '点赞数', key: 'likes', width: 10 },
    { header: '收藏数', key: 'saves', width: 10 },
    { header: '评论数', key: 'comments', width: 10 },
    { header: '分享数', key: 'shares', width: 10 },
    { header: '播放量/浏览量', key: 'views', width: 12 },
    { header: '综合互动率', key: 'engagement', width: 12 },
    { header: '发布时间', key: 'published_at', width: 22 },
    { header: '详情链接', key: 'content_url', width: 45 },
  ];

  // Professional styling for headers
  const headerRow = sheet.getRow(1);
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Microsoft YaHei', bold: true, color: { argb: 'FFFFFF' }, size: 10 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '4F81BD' }, // Muted blue
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  // Add rows
  for (const item of contents) {
    let pubDateStr = '';
    if (item.published_at) {
      try {
        pubDateStr = new Date(item.published_at * 1000).toLocaleString('zh-CN');
      } catch {
        pubDateStr = String(item.published_at);
      }
    }

    const row = sheet.addRow({
      run_id: item.run_id || '',
      platform_label: item.platform_label || item.platform || '',
      keyword: item.keyword || '',
      content_id: item.content_id || '',
      title: item.title || '',
      creator_id: item.creator_id || '',
      creator_name: item.creator_name || '',
      likes: item.likes || 0,
      saves: item.saves || 0,
      comments: item.comments || 0,
      shares: item.shares || 0,
      views: item.views || 0,
      engagement: item.engagement || 0,
      published_at: pubDateStr,
      content_url: item.content_url || '',
    });

    row.height = 20;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.font = { name: 'Microsoft YaHei', size: 9 };
      cell.alignment = { vertical: 'middle' };
      
      // Center code IDs and stats
      if ([1, 2, 3, 4, 6, 8, 9, 10, 11, 12, 13, 14].includes(colNumber)) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      }
    });
  }

  // Auto-fit column widths slightly
  sheet.columns.forEach((column) => {
    let maxLength = 0;
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      const length = cell.value ? String(cell.value).length : 0;
      if (length > maxLength) {
        maxLength = length;
      }
    });
    // Add margin, cap at max
    column.width = Math.min(Math.max(maxLength + 4, column.width || 10), 60);
  });

  // Save to file
  await workbook.xlsx.writeFile(filePath);
  console.log(`[Excel] Excel file successfully written to: ${filePath}`);
}
