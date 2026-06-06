#!/usr/bin/env python3
"""Debug VoxCPM2 crash"""
import sys, os, traceback
sys.stdout = open('/d/wenstar/data/webui/debug.log', 'w', encoding='utf-8')
sys.stderr = sys.stdout

os.environ['CUDA_LAUNCH_BLOCKING'] = '1'
os.environ['TORCH_SHOW_CPP_STACKTRACES'] = '1'

print('Python:', sys.version)
print('Starting...')

try:
    from voxcpm import VoxCPM
    print('Import OK')

    import torch
    print('torch:', torch.__version__)
    print('CUDA available:', torch.cuda.is_available())
    print('Device count:', torch.cuda.device_count())
    if torch.cuda.is_available():
        print('Device:', torch.cuda.get_device_name(0))
        print('Memory:', torch.cuda.get_device_properties(0).total_memory / 1024**2, 'MB')

    print('\nLoading model...')
    model = VoxCPM.from_pretrained(
        '/d/wenstar/voxcpm2/models/weights',
        load_denoiser=False,
        local_files_only=True,
        device='cpu',
    )
    print('Model loaded!')
    print('Sample rate:', model.tts_model.sample_rate)

except Exception as e:
    print('Exception:', e)
    traceback.print_exc()
except SystemExit as e:
    print('SystemExit:', e)
except:
    print('Crash type:', sys.exc_info()[0])
    traceback.print_exc()
finally:
    sys.stdout.flush()
    sys.stderr.flush()
