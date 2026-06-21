import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import '../core/theme.dart';

class DonutSegment {
  final String label;
  final double value;
  final Color color;
  const DonutSegment({required this.label, required this.value, required this.color});
}

class DonutChart extends StatelessWidget {
  final List<DonutSegment> segments;
  final double size;

  const DonutChart({super.key, required this.segments, this.size = 140});

  @override
  Widget build(BuildContext context) {
    if (segments.isEmpty) {
      return SizedBox(
        width: size, height: size,
        child: Center(child: Text('No data', style: Theme.of(context).textTheme.bodySmall)),
      );
    }
    final total = segments.fold(0.0, (s, e) => s + e.value);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          width: size, height: size,
          child: PieChart(PieChartData(
            sections: segments.map((seg) => PieChartSectionData(
              value: seg.value,
              color: seg.color,
              radius: size * 0.28,
              title: '',
            )).toList(),
            centerSpaceRadius: size * 0.3,
            sectionsSpace: 2,
            startDegreeOffset: -90,
          )),
        ),
        const SizedBox(width: 16),
        Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: segments.map((seg) => Padding(
            padding: const EdgeInsets.symmetric(vertical: 3),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              Container(width: 10, height: 10, decoration: BoxDecoration(color: seg.color, shape: BoxShape.circle)),
              const SizedBox(width: 6),
              Text(
                '${seg.label} ${total > 0 ? '${(seg.value / total * 100).toStringAsFixed(0)}%' : ''}',
                style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
              ),
            ]),
          )).toList(),
        ),
      ],
    );
  }
}
