import 'package:flutter/material.dart';
import '../core/theme.dart';

class BudgetBar extends StatelessWidget {
  final double progress; // 0.0 – 1.0+
  final double height;

  const BudgetBar({super.key, required this.progress, this.height = 8});

  Color get _color {
    if (progress > 1.0) return AppColors.danger;
    if (progress >= 0.8) return AppColors.warning;
    return AppColors.accent;
  }

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(height / 2),
      child: LinearProgressIndicator(
        value: progress.clamp(0.0, 1.0),
        minHeight: height,
        color: _color,
        backgroundColor: AppColors.barTrack,
      ),
    );
  }
}
