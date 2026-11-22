package expo.modules.occulert.devicecondition

import android.hardware.camera2.CameraAccessException
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class OcculertConcurrentCameraModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OcculertConcurrentCamera")

    AsyncFunction("getConcurrentLensFacings") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return@AsyncFunction null
      val manager = appContext.reactContext?.getSystemService(CameraManager::class.java)
        ?: return@AsyncFunction null
      // Preserve combinations. Two cameras in different sets may not run together.
      // A failure obtaining the sets rejects the call and remains unknown in readiness.
      manager.concurrentCameraIds.map { group -> group.map { id -> lensFacing(manager, id) } }
    }
  }

  private fun lensFacing(manager: CameraManager, id: String): String = try {
    when (manager.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING)) {
      CameraCharacteristics.LENS_FACING_FRONT -> "front"
      CameraCharacteristics.LENS_FACING_BACK -> "back"
      CameraCharacteristics.LENS_FACING_EXTERNAL -> "external"
      else -> "unknown"
    }
  } catch (_: CameraAccessException) {
    "unknown"
  } catch (_: IllegalArgumentException) {
    // A removable camera can disconnect between the two metadata reads.
    "unknown"
  } catch (_: SecurityException) {
    "unknown"
  }
}
