import 'package:dio/dio.dart';
import 'package:flutter_secure_store/flutter_secure_store.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'config.dart';

class ApiException implements Exception {
  final int status;
  final String message;
  ApiException(this.status, this.message);
  @override
  String toString() => message;
}

class ApiService {
  late final Dio _dio;
  final FlutterSecureStorage _store;

  ApiService(this._store) {
    _dio = Dio(BaseOptions(
      baseUrl: apiUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 15),
      contentType: 'application/json',
    ));

    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await _store.read(key: 'accessToken');
        if (token != null) options.headers['Authorization'] = 'Bearer $token';
        handler.next(options);
      },
      onError: (error, handler) async {
        if (error.response?.statusCode == 401) {
          try {
            await _refresh();
            final token = await _store.read(key: 'accessToken');
            error.requestOptions.headers['Authorization'] = 'Bearer $token';
            final resp = await _dio.fetch(error.requestOptions);
            return handler.resolve(resp);
          } catch (_) {
            await _store.deleteAll();
          }
        }
        final data = error.response?.data;
        final msg = (data is Map ? data['message']?.toString() : null) ?? error.message ?? 'Request failed';
        handler.reject(DioException(
          requestOptions: error.requestOptions,
          error: ApiException(error.response?.statusCode ?? 0, msg),
          response: error.response,
        ));
      },
    ));
  }

  Future<void> _refresh() async {
    final refreshToken = await _store.read(key: 'refreshToken');
    if (refreshToken == null) throw Exception('No refresh token');
    final resp = await Dio().post('$apiUrl/auth/refresh', data: {'refreshToken': refreshToken});
    await _store.write(key: 'accessToken', value: resp.data['accessToken'] as String);
  }

  T _unwrap<T>(Response resp, T Function(dynamic) fromJson) {
    if (resp.statusCode == 204 || resp.data == null) return null as T;
    return fromJson(resp.data);
  }

  Future<T> get<T>(String path, T Function(dynamic) fromJson, {Map<String, dynamic>? params}) async {
    try {
      final resp = await _dio.get(path, queryParameters: params);
      return _unwrap(resp, fromJson);
    } on DioException catch (e) {
      throw e.error ?? ApiException(0, e.message ?? 'Network error');
    }
  }

  Future<T> post<T>(String path, T Function(dynamic) fromJson, {dynamic body}) async {
    try {
      final resp = await _dio.post(path, data: body);
      return _unwrap(resp, fromJson);
    } on DioException catch (e) {
      throw e.error ?? ApiException(0, e.message ?? 'Network error');
    }
  }

  Future<T> put<T>(String path, T Function(dynamic) fromJson, {dynamic body}) async {
    try {
      final resp = await _dio.put(path, data: body);
      return _unwrap(resp, fromJson);
    } on DioException catch (e) {
      throw e.error ?? ApiException(0, e.message ?? 'Network error');
    }
  }

  Future<void> delete(String path) async {
    try {
      await _dio.delete(path);
    } on DioException catch (e) {
      throw e.error ?? ApiException(0, e.message ?? 'Network error');
    }
  }
}

final _storage = const FlutterSecureStorage();

final apiProvider = Provider<ApiService>((ref) => ApiService(_storage));
