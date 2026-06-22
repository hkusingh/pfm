import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class AuthState {
  final bool isAuthenticated;
  final bool isLoading;
  const AuthState({required this.isAuthenticated, required this.isLoading});
}

class AuthNotifier extends ChangeNotifier {
  final FlutterSecureStorage _store;
  bool _isAuthenticated = false;
  bool _isLoading = true;

  bool get isAuthenticated => _isAuthenticated;
  bool get isLoading => _isLoading;

  AuthNotifier(this._store) {
    _init();
  }

  Future<void> _init() async {
    final token = await _store.read(key: 'accessToken');
    _isAuthenticated = token != null;
    _isLoading = false;
    notifyListeners();
  }

  Future<void> setTokens(String access, String refresh) async {
    await _store.write(key: 'accessToken', value: access);
    await _store.write(key: 'refreshToken', value: refresh);
    _isAuthenticated = true;
    notifyListeners();
  }

  Future<void> clearTokens() async {
    await _store.deleteAll();
    _isAuthenticated = false;
    notifyListeners();
  }
}

final authProvider = ChangeNotifierProvider<AuthNotifier>(
  (ref) => AuthNotifier(const FlutterSecureStorage()),
);
